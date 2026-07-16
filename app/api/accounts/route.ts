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

    const accounts = (data || []).map((u: any) => ({
      id: String(u.id),
      username: u.username,
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
