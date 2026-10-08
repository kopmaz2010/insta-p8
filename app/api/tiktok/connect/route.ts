/* @ts-nocheck */

// TikTok hesabi bagla — adim 1: panelden ?user_id=<InstaAuto users.id> ile gelinir,
// sahiplik dogrulanir, TikTok yetki ekranina yonlendirilir. (8 Eki 2026)

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireOwner } from "@/lib/app-auth"
import { authorizeUrl, signState } from "@/lib/tiktok"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const userId = url.searchParams.get("user_id")
  const supabase = await getSupabaseServerClient()
  const g = await requireOwner(supabase, request, userId)
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status })
  try {
    return NextResponse.redirect(authorizeUrl(signState(String(userId))))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 503 }) // TIKTOK_APP_ID vb. eksik
  }
}
