/* @ts-nocheck */

// Bagli tum Instagram hesaplarini listeler (hesap degistirici icin).
// Middleware korumasi altinda (panel sifresi) — token DONDURMEZ, yalnizca kimlik+saglik.

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("users")
      .select("id, username, business_account_id, token_expires_at, updated_at")
      .order("username", { ascending: true })
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
