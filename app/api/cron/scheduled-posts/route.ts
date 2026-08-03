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
import { createReelsContainer, createImageContainer, createCarouselContainer, getContainerStatus, publishContainer } from "@/lib/instagram-publishing"
import { checkCronSecret } from "@/lib/cron-auth"

export const maxDuration = 60
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))


/**
 * Yayinlanan reel'in caption'indaki anahtar kelimeyi, ayni isimli yorum
 * kuralina BAGLAR (specific_media_id). Boylece kural yalnizca kendi
 * videosunda calisir.
 *
 * Neden: "Hepsi", "Manifest" gibi anahtarlar ayni zamanda gunluk Turkce
 * kelime. Kural global kaldiginda baska bir videoya "Hepsi ❤️" yazan
 * kisiye alakasiz video DM'i gidiyordu (ikilem vakasi, 3 Agu).
 */
async function anahtariVideoyaBagla(
  supabase: any,
  userId: string,
  caption: string | null,
  mediaId: string,
) {
  const m = (caption || "").match(/Yoruma\s+"([^"]+)"/)
  if (!m) return
  const anahtar = m[1].toLocaleLowerCase("tr-TR")
  try {
    const { data: kurallar } = await supabase
      .from("automations")
      .select("id, specific_media_id")
      .eq("user_id", userId)
      .eq("trigger_value", anahtar)
      .eq("trigger_source", "comment")
    if (!kurallar?.length) return

    // Bu videoya zaten bagli bir kural varsa dokunma
    if (kurallar.some((k: any) => k.specific_media_id === mediaId)) return

    const bos = kurallar.find((k: any) => !k.specific_media_id)
    if (bos) {
      await supabase
        .from("automations")
        .update({ specific_media_id: mediaId, is_active: true })
        .eq("id", bos.id)
      console.log(`[SchedPosts] 🔗 "${anahtar}" kurali ${mediaId} videosuna baglandi`)
    }
  } catch (e) {
    console.error("[SchedPosts] anahtar baglama hatasi:", e)
  }
}

export async function GET(request: Request) {
  if (!checkCronSecret(request).ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const supabase = await getSupabaseServerClient()
  const { data: due } = await supabase
    .from("scheduled_posts")
    .select("*, user_id_s:user_id::text")
    .in("status", ["pending", "processing", "publishing"])
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(2) // 60 sn butcesi: kosu basina en fazla 2 kayit

  const results: any[] = []
  for (const post of due || []) {
    if (post.user_id_s) post.user_id = post.user_id_s // BIGINT yuvarlanma fix'i
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

      // CAROUSEL kayitlarinda video_url bostur; dedup/kayit anahtari ilk gorseldir
      const images: string[] = Array.isArray(post.image_urls) ? post.image_urls : []
      const isCarousel = post.media_type === "CAROUSEL"
      const mediaKey = post.video_url || images[0] || null

      // TEKRAR-PAYLASIM KORUMASI: ayni medya bu hesapta zaten yayinlandiysa iptal
      if (post.status === "pending" && mediaKey) {
        const { data: dupe } = await supabase
          .from("reels_posts")
          .select("id")
          .eq("user_id", post.user_id)
          .eq("video_url", mediaKey)
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
          if (isCarousel) {
            // Cocuk gorseller sirayla (IG sirayi children parametresinden alir)
            const childIds: string[] = []
            for (const url of images.slice(0, 10)) {
              childIds.push(await createImageContainer(user.access_token, url, { carouselItem: true }))
            }
            containerId = await createCarouselContainer(
              user.access_token,
              childIds,
              post.caption || "",
              post.as_ai === true, // yapay zeka etiketi
            )
          } else {
            containerId = await createReelsContainer(
              user.access_token,
              post.video_url,
              post.caption || "",
              post.cover_url || undefined, // reels kapak gorseli (dikey)
              post.as_trial ? "SS_PERFORMANCE" : null,
              post.as_ai === true, // yapay zeka etiketi
            )
          }
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
          video_url: mediaKey,
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
        video_url: mediaKey,
        caption: post.caption,
        ig_container_id: containerId,
        ig_media_id: mediaId,
        status: "PUBLISHED",
        published_at: nowIso,
      })
      await anahtariVideoyaBagla(supabase, post.user_id, post.caption, mediaId)
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
