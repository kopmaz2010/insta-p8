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

  console.log(`[cron] token refresh bitti: ${refreshed} yenilendi, ${skipped} atlandi, ${failed} hata`)
  return NextResponse.json({ ok: true, refreshed, skipped, failed })
}
