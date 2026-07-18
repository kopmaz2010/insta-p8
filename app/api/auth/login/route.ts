/* @ts-nocheck */

// COK KULLANICILI GIRIS
// POST {code}: erisim kodu app_accounts hash'leriyle dogrulanir → ia_sess cookie.
// GET: oturum durumu — dashboard layout'u bununla /giris yonlendirmesi yapar.
// Kod duz metin SAKLANMAZ; yalnizca scrypt hash karsilastirilir.

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { verifyCode, signSession, getSessionAccount, SESSION_COOKIE } from "@/lib/app-auth"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function GET(request: Request) {
  if (!process.env.API_SECRET_KEY) return NextResponse.json({ protected: false, authenticated: true })
  const supabase = await getSupabaseServerClient()
  const account = await getSessionAccount(supabase, request)
  return NextResponse.json({
    protected: true,
    authenticated: Boolean(account),
    name: account?.name || null,
    isAdmin: Boolean(account?.is_admin),
    mustChange: Boolean(account?.must_change),
  })
}

export async function POST(request: Request) {
  if (!process.env.API_SECRET_KEY) {
    return NextResponse.json({ ok: true, note: "API_SECRET_KEY tanimli degil — koruma kapali" })
  }
  const { code } = await request.json().catch(() => ({}))
  if (!code || typeof code !== "string" || code.length < 6) {
    return NextResponse.json({ error: "Kod hatalı" }, { status: 401 })
  }

  const supabase = await getSupabaseServerClient()
  const { data: accounts, error } = await supabase
    .from("app_accounts")
    .select("id, name, is_admin, must_change, code_hash, sess_ver")
  if (error) return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 })

  const match = (accounts || []).find((a: any) => verifyCode(code, a.code_hash))
  if (!match) {
    await sleep(400) // kaba-kuvvet yavaslatma
    return NextResponse.json({ error: "Kod hatalı" }, { status: 401 })
  }

  const res = NextResponse.json({
    ok: true,
    name: match.name,
    isAdmin: Boolean(match.is_admin),
    mustChange: Boolean(match.must_change),
  })
  res.cookies.set(SESSION_COOKIE, signSession(String(match.id), match.sess_ver ?? 0), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  })
  return res
}
