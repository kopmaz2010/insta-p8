/* @ts-nocheck */

// Yonetici araci: TikTok webhook aboneligini kur / listele. (8 Eki 2026)
//   GET /api/tiktok/setup                → mevcut abonelik (webhook/list)
//   GET /api/tiktok/setup?action=update  → callback_url = <origin>/api/tiktok/webhook olarak kaydet
// Yalniz admin oturumu. Uygulama kimligiyle calisir (TIKTOK_APP_ID/SECRET), token gerekmez.

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSessionAccount } from "@/lib/app-auth"
import { webhookList, webhookUpdate } from "@/lib/tiktok"

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient()
  const acc = await getSessionAccount(supabase, request)
  if (!acc?.is_admin) return NextResponse.json({ error: "yalniz yonetici" }, { status: 403 })
  const url = new URL(request.url)
  try {
    if (url.searchParams.get("action") === "update") {
      const callback = process.env.TIKTOK_WEBHOOK_URL || `${url.origin}/api/tiktok/webhook`
      const r = await webhookUpdate(callback)
      return NextResponse.json({ action: "update", callback, sonuc: r })
    }
    return NextResponse.json({ action: "list", sonuc: await webhookList() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 503 })
  }
}
