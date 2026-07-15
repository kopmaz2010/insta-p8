/* @ts-nocheck */

// ============================================================
// YORUM YOKLAYICI (webhook'suz fallback)
// Meta, Standart Erisim'de yalnizca Instagram Tester rolu olan hesaplara
// webhook eventi gonderir. Rolu olmayan/daveti bekleyen hesaplarda otomasyon
// "sebepsiz" oluyordu. Bu cron her calismada son gonderilerin yorumlarini
// Graph API'den CEKER (push degil pull), kelime eslesirse webhook akisiyla
// AYNI kurallarla cevaplar:
//  - dedup anahtarlari webhook'la ORTAK (comment_/once_) → tester rolu gelip
//    webhook devreye girse bile ayni yoruma IKI kez cevap gidemez
//  - gunluk/saatlik limit + devre kesici ayni sekilde uygulanir
//  - takip-kapili (check_follow) kurallar burada islenmez (postback butonu
//    webhook ister) — yalnizca duz mesajli kurallar
// Tetikleyici: VPS crontab */5 (scheduled-posts ile ayni desen).
// ============================================================

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { keywordMatches } from "@/lib/tr-match"
import { rateLimitCoolingDown, recordRateLimitHit, underHourlyLimit, underDailyLimitG } from "@/lib/gamification"

export const maxDuration = 60
const GRAPH = "https://graph.instagram.com/v24.0"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DEFAULT_PUBLIC_REPLIES = ["DM'ne bak! 📩", "Gönderdim, DM'ni kontrol et! 🔥", "DM kutuna düştü! ✨"]
const MEDIA_LIMIT = 5 // hesap basina son N gonderi
const COMMENT_WINDOW_H = 24 // bundan eski yorumlara donme

async function claim(supabase: any, key: string, type: string, userId: any): Promise<boolean> {
  const { error } = await supabase.from("webhook_events").insert({ event_key: key, event_type: type, user_id: userId })
  if (!error) return true
  if (error.code === "23505") return false
  console.error("[poller] claim hatasi:", error)
  return false // fail-closed: dedup dogrulanamiyorsa cevap gonderme
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const supabase = await getSupabaseServerClient()
  const { data: users } = await supabase.from("users").select("*")
  const results: any[] = []

  for (const user of users || []) {
    if (!user.access_token) continue
    const { data: automations } = await supabase
      .from("automations")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("trigger_source", "comment")
    if (!automations?.length) continue

    // ozellestirilmis public cevaplar
    const { data: cust } = await supabase.from("dm_customization").select("*").eq("user_id", user.id).single()
    const publicReplies = (cust?.public_replies || []).filter((r: any) => r && r.trim()).slice(0, 5)
    const replies = publicReplies.length ? publicReplies : DEFAULT_PUBLIC_REPLIES

    // son gonderiler
    let mediaList: any[] = []
    try {
      const mres = await fetch(
        `${GRAPH}/me/media?fields=id,timestamp&limit=${MEDIA_LIMIT}&access_token=${encodeURIComponent(user.access_token)}`,
      ).then((r) => r.json())
      if (mres?.error) {
        results.push({ user: user.username, status: "token-hatasi", error: mres.error.message })
        continue
      }
      mediaList = mres?.data || []
    } catch (e: any) {
      results.push({ user: user.username, status: "media-hatasi", error: String(e?.message || e) })
      continue
    }

    let handled = 0
    for (const media of mediaList) {
      let comments: any[] = []
      try {
        const cres = await fetch(
          `${GRAPH}/${media.id}/comments?fields=id,text,from,timestamp&limit=50&access_token=${encodeURIComponent(user.access_token)}`,
        ).then((r) => r.json())
        comments = cres?.data || []
      } catch {
        continue
      }

      for (const c of comments) {
        if (!c?.text || !c?.id) continue
        const senderId = c?.from?.id
        // pencere disi (eski) yorumlar
        if (c.timestamp && Date.now() - new Date(c.timestamp).getTime() > COMMENT_WINDOW_H * 3600_000) continue

        // izleme: webhook'la ayni raw anahtari (cift kayit olmaz)
        await claim(supabase, `raw_comment_${c.id}`, "recv_comment_poll", user.id)

        // self-comment atla
        if (!senderId || senderId === user.business_account_id || senderId === user.page_id) continue

        const text = (c.text || "").toLocaleLowerCase("tr").trim()
        // eslesme onceligi webhook'la ayni: reply_all(spesifik) > keyword(spesifik) > keyword(global)
        const commentAutos = automations
        let match = commentAutos.find((a: any) => a.specific_media_id === media.id && a.trigger_type === "reply_all")
        if (!match)
          match = commentAutos.find(
            (a: any) => a.specific_media_id === media.id && a.trigger_type === "keyword" && keywordMatches(text, a.trigger_value),
          )
        if (!match)
          match = commentAutos.find(
            (a: any) => !a.specific_media_id && a.trigger_type === "keyword" && keywordMatches(text, a.trigger_value),
          )
        if (!match) continue

        const content = typeof match.response_content === "string" ? JSON.parse(match.response_content) : match.response_content
        // takip-kapili / kartli kurallar webhook ister — poller karisamaz
        if (content?.check_follow || (!content?.message && content?.card)) continue

        // dedup: webhook'la AYNI anahtar — kim once islerse digeri susar
        if (!(await claim(supabase, `comment_${c.id}`, "recv_comment", user.id))) continue

        // limitler + devre kesici
        if (!(await underDailyLimitG(supabase, user.id))) break
        if (!(await underHourlyLimit(supabase, user.id))) break
        if (await rateLimitCoolingDown(supabase, user.id)) break

        // kisi+kural gunde 1 teslimat (webhook'la ayni anahtar)
        const dgun = new Date().toISOString().slice(0, 10)
        if (!(await claim(supabase, `once_${match.id}_${senderId}_${dgun}`, "send_dm", user.id))) continue

        await sleep(1500 + Math.random() * 2500)

        // 1) public cevap
        try {
          const pr = await fetch(
            `${GRAPH}/${c.id}/replies?access_token=${encodeURIComponent(user.access_token)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: replies[Math.floor(Math.random() * replies.length)] }),
            },
          ).then((r) => r.json())
          if (pr?.error) await recordRateLimitHit(supabase, user.id, pr.error)
        } catch {}

        // 2) ozel DM (private reply — comment_id ile 7 gun penceresi)
        try {
          const dm = await fetch(
            `${GRAPH}/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recipient: { comment_id: c.id }, message: { text: content.message } }),
            },
          ).then((r) => r.json())
          if (dm?.error) {
            console.error(`[poller] 🔴 DM hatasi (${user.username}):`, JSON.stringify(dm.error))
            await recordRateLimitHit(supabase, user.id, dm.error)
          } else {
            handled++
            console.log(`[poller] 🟢 Yorum cevaplandi: ${user.username} / ${c.id}`)
          }
        } catch (e) {
          console.error("[poller] DM network hatasi:", e)
        }
      }
    }
    results.push({ user: user.username, status: "ok", handled })
  }

  return NextResponse.json({ ok: true, results })
}
