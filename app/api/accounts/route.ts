/* @ts-nocheck */

// Bagli Instagram hesaplarini listeler (hesap degistirici icin).
// SAHIPLIK: yalnizca oturumdaki kullanicinin hesaplari doner (admin: hepsi).
// Token DONDURMEZ, yalnizca kimlik+saglik.

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSessionAccount, ownerFilterId } from "@/lib/app-auth"

export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseServerClient()
    const session = await getSessionAccount(supabase, request)
    if (process.env.API_SECRET_KEY && !session) {
      return NextResponse.json({ error: "oturum yok" }, { status: 401 })
    }

    let q = supabase
      .from("users")
      .select("id::text, username, business_account_id, token_expires_at, updated_at, owner_id")
      .order("username", { ascending: true })
    const ownerId = ownerFilterId(session)
    if (ownerId) q = q.eq("owner_id", ownerId)
    const { data, error } = await q
    if (error) throw error

    // TikTok baglantisi (8 Eki 2026): tiktok_accounts users.id'ye baglidir. Tablo yoksa sessizce gec.
    const tiktokMap: Record<string, any> = {}
    try {
      const { data: tt } = await supabase
        .from("tiktok_accounts")
        .select("open_id, user_id::text, username, is_active, token_expires_at")
      for (const t of tt || []) tiktokMap[String(t.user_id)] = t
    } catch {}

    const accounts = (data || []).map((u: any) => ({
      id: String(u.id),
      username: u.username,
      tiktok: tiktokMap[String(u.id)]
        ? {
            username: tiktokMap[String(u.id)].username,
            healthy: !!tiktokMap[String(u.id)].is_active && !!tiktokMap[String(u.id)].token_expires_at && new Date(tiktokMap[String(u.id)].token_expires_at).getTime() > Date.now(),
          }
        : null,
      // saglik: token suresi gecerli + kimlik duzgun (user_XXX fallback degil)
      healthy:
        !!u.token_expires_at &&
        new Date(u.token_expires_at).getTime() > Date.now() &&
        !String(u.username || "").startsWith("user_"),
      tokenExpiresAt: u.token_expires_at,
    }))
    return NextResponse.json(accounts)
  } catch (error) {
    console.error("Accounts GET Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
