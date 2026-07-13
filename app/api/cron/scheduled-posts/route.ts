/* @ts-nocheck */

// ============================================================
// ZAMANLANMIS REELS PAYLASIMI
// Instagram API belirli saate yayin desteklemez; scheduled_posts tablosundaki
// zamani gelen kayitlari bu endpoint yayinlar. Tetikleyici: GitHub Actions
// (.github/workflows/scheduled-posts.yml, ~10 dk'da bir) — Vercel Hobby cron
// gunde 1 calistigi icin dis tetikleyici kullanildi.
// Endpoint korumasizdir ama deterministiktir: yalnizca scheduled_at <= now
// olan kayitlari isler (erken yayin tetiklenemez, veri sizdirmaz).
// CIFT-PAYLASIM GUVENLIGI: publish timeout'unda status 'processing' kalir;
// sonraki kosuda container status PUBLISHED ise tekrar publish EDILMEZ.
// ============================================================

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { createReelsContainer, getContainerStatus, publishContainer } from "@/lib/instagram-publishing"

export const maxDuration = 60
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: due } = await supabase
    .from("scheduled_posts")
    .select("*")
    .in("status", ["pending", "processing", "publishing"])
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(2) // 60 sn butcesi: kosu basina en fazla 2 kayit

  const results: any[] = []
  for (const post of due || []) {
    const log: any = { id: post.id, video: (post.video_url || "").split("/").pop() }
    try {
      const { data: user } = await supabase.from("users").select("*").eq("id", post.user_id).single()
      if (!user?.access_token) {
        // kalici hata: tekrar denemenin anlami yok, kuyrugun basini tikamasin
        await supabase
          .from("scheduled_posts")
          .update({ status: "error", error_message: "kullanici/token bulunamadi" })
          .eq("id", post.id)
        results.push({ ...log, status: "hata:token-yok" })
        continue
      }

      // TEKRAR-PAYLASIM KORUMASI: ayni video bu hesapta zaten yayinlandiysa iptal
      if (post.status === "pending") {
        const { data: dupe } = await supabase
          .from("reels_posts")
          .select("id")
          .eq("user_id", post.user_id)
          .eq("video_url", post.video_url)
          .in("status", ["PUBLISHED", "success"])
          .limit(1)
        if (dupe?.length) {
          await supabase
            .from("scheduled_posts")
            .update({ status: "error", error_message: "duplicate: bu video bu hesapta zaten paylasilmis" })
            .eq("id", post.id)
          results.push({ ...log, status: "duplicate-engellendi" })
          continue
        }
      }

      // Container (yoksa olustur; varsa kaldigi yerden devam)
      let containerId = post.ig_container_id
      if (!containerId) {
        // ATOMIK CLAIM: es zamanli iki tetik ayni kaydi almasin (cift container/yayin onlenir)
        const { data: claimed } = await supabase
          .from("scheduled_posts")
          .update({ status: "processing" })
          .eq("id", post.id)
          .eq("status", "pending")
          .select("id")
        if (!claimed?.length) {
          results.push({ ...log, status: "baska-kosu-isliyor" })
          continue
        }
        try {
          containerId = await createReelsContainer(
            user.access_token,
            post.video_url,
            post.caption || "",
            undefined,
            post.as_trial ? "SS_PERFORMANCE" : null,
            post.as_ai === true, // yapay zeka etiketi
          )
        } catch (ce: any) {
          // container hic olusmadi → 'processing'de birakma; kayit kalici hataya
          // dusurulur ki kuyrugun basini sonsuza dek tikamasin (panelden gorunur)
          await supabase
            .from("scheduled_posts")
            .update({ status: "error", error_message: `container olusturulamadi: ${String(ce?.message || ce)}` })
            .eq("id", post.id)
          results.push({ ...log, status: "hata:container", error: String(ce?.message || ce) })
          continue
        }
        await supabase.from("scheduled_posts").update({ ig_container_id: containerId }).eq("id", post.id)
      }

      // Islenme durumu
      let st = await getContainerStatus(user.access_token, containerId)
      let tries = 0
      while (st === "IN_PROGRESS" && tries < 6) {
        await sleep(5000)
        st = await getContainerStatus(user.access_token, containerId)
        tries++
      }

      if (st === "PUBLISHED") {
        // Onceki kosuda publish timeout olmus ama yayin GERCEKLESMIS — tekrar yayinlama!
        const recIso = new Date().toISOString()
        await supabase
          .from("scheduled_posts")
          .update({ status: "published", published_at: recIso, error_message: null })
          .eq("id", post.id)
        // dupe korumasi reels_posts'a bakar — kurtarilan yayini da kaydet
        await supabase.from("reels_posts").insert({
          user_id: post.user_id,
          video_url: post.video_url,
          caption: post.caption,
          ig_container_id: containerId,
          status: "PUBLISHED",
          published_at: recIso,
        })
        results.push({ ...log, status: "published(kurtarildi)" })
        continue
      }
      if (st === "IN_PROGRESS") {
        results.push({ ...log, status: "isleniyor-sonraki-kosuda" })
        continue
      }
      if (st !== "FINISHED") {
        await supabase
          .from("scheduled_posts")
          .update({ status: "error", error_message: `container durumu: ${st}` })
          .eq("id", post.id)
        results.push({ ...log, status: `hata:${st}` })
        continue
      }

      // YAYIN CLAIM'i: publish adimi da tek kosuya kilitlenir (cift yayin onlenir).
      // 'publishing'de kalmis eski kayit (kosu olurse): 15 dk sonra error_message
      // uzerinden CAS ile yeniden claim edilir; PUBLISHED kurtarmasi yukarida.
      const pubStamp = `publishing:${new Date().toISOString()}`
      let claimedPublish = false
      if (post.status === "publishing") {
        const m = /^publishing:(.+)$/.exec(post.error_message || "")
        const since = m ? new Date(m[1]).getTime() : 0
        if (Date.now() - since > 15 * 60_000) {
          const { data: rec } = await supabase
            .from("scheduled_posts")
            .update({ error_message: pubStamp })
            .eq("id", post.id)
            .eq("status", "publishing")
            .eq("error_message", post.error_message)
            .select("id")
          claimedPublish = Boolean(rec?.length)
        }
      } else {
        const { data: pub } = await supabase
          .from("scheduled_posts")
          .update({ status: "publishing", error_message: pubStamp })
          .eq("id", post.id)
          .eq("status", "processing")
          .select("id")
        claimedPublish = Boolean(pub?.length)
      }
      if (!claimedPublish) {
        results.push({ ...log, status: "yayin-baska-kosuda" })
        continue
      }

      // Yayinla + logla
      const mediaId = await publishContainer(user.access_token, containerId)
      const nowIso = new Date().toISOString()
      await supabase
        .from("scheduled_posts")
        .update({ status: "published", ig_media_id: mediaId, published_at: nowIso, error_message: null })
        .eq("id", post.id)
      await supabase.from("reels_posts").insert({
        user_id: post.user_id,
        video_url: post.video_url,
        caption: post.caption,
        ig_container_id: containerId,
        ig_media_id: mediaId,
        status: "PUBLISHED",
        published_at: nowIso,
      })
      console.log(`[SchedPosts] 🟢 Yayinlandi: ${log.video} → ${mediaId}`)
      results.push({ ...log, status: "published", mediaId })
    } catch (e: any) {
      // Gecici/kalici ayirt edilemez: 'processing' birakilir; PUBLISHED kontrolu
      // cift yayini engeller, kalici hatada 10 dk'da 1 hafif deneme surer.
      console.error("[SchedPosts] 🔴 hata:", e)
      await supabase
        .from("scheduled_posts")
        .update({ error_message: String(e?.message || e) })
        .eq("id", post.id)
      results.push({ ...log, status: "hata", error: String(e?.message || e) })
    }
  }

  return NextResponse.json({ ok: true, checked: (due || []).length, results })
}
