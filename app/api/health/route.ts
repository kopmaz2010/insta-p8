/* @ts-nocheck */

// ============================================================
// SISTEM SAGLIGI — hesap basina otomasyon zincirinin durumu.
// "Otomasyon calismiyor" sikayetinde loglara/Meta paneline muhtac
// kalmamak icin: token, webhook aboneligi, son event yasi tek uctan.
// Panel (cookie) korumali — middleware varsayilani yeterli.
// ============================================================

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export const maxDuration = 60

export async function GET() {
  const supabase = await getSupabaseServerClient()
  const { data: users } = await supabase.from("users").select("id::text, username, business_account_id, access_token")

  const out: any[] = []
  for (const u of users || []) {
    const row: any = { id: u.id, username: u.username }

    // 1) Token sagligi (/me)
    try {
      const me = await fetch(
        `https://graph.instagram.com/v24.0/me?fields=user_id,username&access_token=${encodeURIComponent(u.access_token || "")}`,
      ).then((r) => r.json())
      row.tokenOk = Boolean(me?.user_id) && !me?.error
      row.tokenError = me?.error?.message || null
      row.identityMatch = me?.user_id ? String(me.user_id) === String(u.business_account_id) : null
    } catch (e: any) {
      row.tokenOk = false
      row.tokenError = String(e?.message || e)
    }

    // 2) Webhook aboneligi
    try {
      const sub = await fetch(
        `https://graph.instagram.com/v23.0/me/subscribed_apps?access_token=${encodeURIComponent(u.access_token || "")}`,
      ).then((r) => r.json())
      row.subscribedFields = sub?.data?.[0]?.subscribed_fields || []
      row.subscribed = row.subscribedFields.includes("comments") && row.subscribedFields.includes("messages")
    } catch {
      row.subscribed = false
      row.subscribedFields = []
    }

    // 3) Son webhook eventi (Meta gercekten gonderiyor mu?)
    const { data: last } = await supabase
      .from("webhook_events")
      .select("processed_at, event_type")
      .eq("user_id", u.id)
      .order("processed_at", { ascending: false })
      .limit(1)
    row.lastEventAt = last?.[0]?.processed_at || null
    row.lastEventType = last?.[0]?.event_type || null

    const { count: c24 } = await supabase
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", u.id)
      .gte("processed_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    row.events24h = c24 || 0

    // Ozet teshis
    if (!row.tokenOk) row.verdict = "TOKEN BOZUK — hesabı yeniden bağla"
    else if (!row.subscribed) row.verdict = "WEBHOOK ABONELİĞİ EKSİK — otomatik onarım cron'da denenir"
    else if (!row.lastEventAt)
      row.verdict = "META EVENT GÖNDERMİYOR — muhtemel sebep: Instagram Tester rolü eksik/kabul edilmemiş (Standart Erişim)"
    else row.verdict = "SAĞLIKLI"

    out.push(row)
  }

  return NextResponse.json({ checkedAt: new Date().toISOString(), accounts: out })
}
