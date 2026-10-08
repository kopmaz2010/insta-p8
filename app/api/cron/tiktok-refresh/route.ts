/* @ts-nocheck */

// TikTok access token ~24 saat, refresh token ~30 gun. Bu cron SAATLIK calisir:
// 3 saatten az omru kalan access token'lari yeniler. Refresh token'in 5 gunden
// az omru kaldiysa uyarir (hesabi yeniden baglamak gerekir; /api/tiktok/connect).
// vercel.json: "/api/cron/tiktok-refresh" "15 * * * *"  (8 Eki 2026)

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { checkCronSecret } from "@/lib/cron-auth"
import { refreshToken } from "@/lib/tiktok"

export const maxDuration = 60

export async function GET(request: Request) {
  if (!checkCronSecret(request).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const supabase = await getSupabaseServerClient()
  const { data: hesaplar, error } = await supabase
    .from("tiktok_accounts")
    .select("open_id, username, refresh_token, token_expires_at, refresh_expires_at, is_active")
    .eq("is_active", true)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const out: any[] = []
  for (const h of hesaplar || []) {
    const kalanSaat = h.token_expires_at ? (new Date(h.token_expires_at).getTime() - Date.now()) / 3600e3 : 0
    const refreshKalanGun = h.refresh_expires_at ? (new Date(h.refresh_expires_at).getTime() - Date.now()) / 86400e3 : 0
    const satir: any = { open_id: h.open_id, username: h.username, kalanSaat: Math.round(kalanSaat * 10) / 10, refreshKalanGun: Math.round(refreshKalanGun) }
    if (refreshKalanGun < 5) satir.uyari = "refresh token bitiyor — hesabi yeniden bagla"
    if (kalanSaat > 3 || !h.refresh_token) { satir.durum = "atlandi"; out.push(satir); continue }
    try {
      const t = await refreshToken(h.refresh_token)
      const { error: e2 } = await supabase.from("tiktok_accounts").update({
        access_token: t.access_token, refresh_token: t.refresh_token || h.refresh_token,
        token_expires_at: t.token_expires_at, refresh_expires_at: t.refresh_expires_at, updated_at: new Date().toISOString(),
      }).eq("open_id", h.open_id)
      satir.durum = e2 ? `db hatasi: ${e2.message}` : "yenilendi"
    } catch (e: any) {
      satir.durum = `hata: ${String(e.message || e).slice(0, 120)}`
      console.error("[tiktok-refresh]", h.open_id, e)
    }
    out.push(satir)
  }
  return NextResponse.json({ ok: true, hesaplar: out })
}
