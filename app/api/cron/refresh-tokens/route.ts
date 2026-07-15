/* @ts-nocheck */

// FAZ1-A2: Instagram token'lari 60 gunde oluyor — bu cron her gun calisip
// suresi 15 gunden az kalan token'lari yeniler (ig_refresh_token).
// vercel.json'daki cron tanimi bu endpoint'i tetikler.

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export const maxDuration = 60

const REFRESH_THRESHOLD_DAYS = 15

export async function GET(request: Request) {
  // Vercel Cron, CRON_SECRET env varsa Authorization: Bearer <secret> gonderir
  const auth = request.headers.get("authorization")
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const supabase = await getSupabaseServerClient()
  const { data: users, error } = await supabase
    .from("users")
    .select("id, username, access_token, token_expires_at")

  if (error) {
    console.error("[cron] users okunamadi:", error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  let refreshed = 0
  let skipped = 0
  let failed = 0

  for (const u of users || []) {
    if (!u.access_token) continue
    const daysLeft = u.token_expires_at
      ? (new Date(u.token_expires_at).getTime() - Date.now()) / 86400000
      : 0

    if (daysLeft > REFRESH_THRESHOLD_DAYS) {
      skipped++
      continue
    }

    try {
      const res = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(u.access_token)}`,
      )
      const json = await res.json()
      if (json.access_token) {
        await supabase
          .from("users")
          .update({
            access_token: json.access_token,
            token_expires_at: new Date(Date.now() + (json.expires_in || 5184000) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", u.id)
        console.log(`[cron] ✅ Token yenilendi: ${u.username}`)
        refreshed++
      } else {
        console.error(`[cron] 🔴 Token yenilenemedi (${u.username}):`, JSON.stringify(json))
        failed++
      }
    } catch (e) {
      console.error(`[cron] 🔴 Token yenileme hatasi (${u.username}):`, e)
      failed++
    }
  }

  // OTO-ONARIM: webhook aboneligi dusmus hesaplari yeniden abone et.
  // (fabrika_muzik/hayranimsinapp vakalari: abonelik sessizce eksilirse
  // otomasyon "sebepsiz" olur. Gunluk cron kendini onarir + bildirir.)
  let resubscribed = 0
  const subProblems: string[] = []
  for (const u of users || []) {
    if (!u.access_token) continue
    try {
      const sub = await fetch(
        `https://graph.instagram.com/v23.0/me/subscribed_apps?access_token=${encodeURIComponent(u.access_token)}`,
      ).then((r) => r.json())
      const fields = sub?.data?.[0]?.subscribed_fields || []
      if (!fields.includes("comments") || !fields.includes("messages")) {
        const fix = await fetch(
          `https://graph.instagram.com/v23.0/me/subscribed_apps?subscribed_fields=comments,messages&access_token=${encodeURIComponent(u.access_token)}`,
          { method: "POST" },
        ).then((r) => r.json())
        if (fix?.success) {
          resubscribed++
          console.log(`[cron] 🔧 Webhook aboneligi onarildi: ${u.username}`)
        } else {
          subProblems.push(u.username)
          console.error(`[cron] 🔴 Abonelik onarilamadi (${u.username}):`, JSON.stringify(fix))
        }
      }
    } catch (e) {
      subProblems.push(u.username)
      console.error(`[cron] 🔴 Abonelik kontrolu hatasi (${u.username}):`, e)
    }
  }

  // MADDE 6 (10-ACIK): 30 gunden eski webhook_events kayitlarini temizle —
  // tablo sismesi her mesajda calisan limit sorgularini yavaslatiyordu.
  // (dedup anahtarlari gunluk/saatlik; 30 gun fazlasiyla guvenli)
  let purged = 0
  try {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    const { count, error: purgeErr } = await supabase
      .from("webhook_events")
      .delete({ count: "exact" })
      .lt("processed_at", cutoff)
    if (purgeErr) console.error("[cron] event temizligi hatasi:", purgeErr)
    else purged = count || 0
  } catch (e) {
    console.error("[cron] event temizligi exception:", e)
  }

  // MADDE 4 (10-ACIK): sonuc bildirimi — TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
  // env'leri ekliyse hata/yenileme durumunda Telegram'a mesaj atar (sessiz olum yok)
  const summary =
    `🔑 InstaAuto token cron: ${refreshed} yenilendi, ${skipped} atlandı, ${failed} HATA` +
    `${purged ? ` · 🧹 ${purged} eski event temizlendi` : ""}` +
    `${resubscribed ? ` · 🔧 ${resubscribed} webhook aboneliği onarıldı` : ""}` +
    `${subProblems.length ? ` · 🔴 abonelik sorunu: ${subProblems.join(",")}` : ""}`
  if (failed > 0 || refreshed > 0 || resubscribed > 0 || subProblems.length > 0)
    await notifyTelegram(failed > 0 || subProblems.length > 0 ? `⚠️ ${summary}` : summary)

  console.log(`[cron] token refresh bitti: ${refreshed} yenilendi, ${skipped} atlandi, ${failed} hata, ${purged} event temizlendi, ${resubscribed} abonelik onarildi`)
  return NextResponse.json({ ok: true, refreshed, skipped, failed, purged, resubscribed, subProblems })
}

async function notifyTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return // kurulmamis — sessizce gec
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch (e) {
    console.error("[cron] telegram bildirimi gonderilemedi:", e)
  }
}
