/* @ts-nocheck */

// KULLANICI YONETIMI (yalnizca admin)
// GET: kullanici listesi (kod ASLA donmez — hash zaten geri cevrilemez)
// POST {name}: yeni kullanici + rastgele erisim kodu uretir; kod YALNIZCA
// bu cevapta bir kez gorunur, sonra sadece hash saklanir.
// DELETE {id}: kullanici siler (IG hesaplari sahipsiz kalir, admin gorur).

import { NextResponse } from "next/server"
import crypto from "crypto"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSessionAccount, hashCode } from "@/lib/app-auth"

async function requireAdmin(supabase: any, request: Request) {
  const account = await getSessionAccount(supabase, request)
  if (!account) return { err: NextResponse.json({ error: "oturum yok" }, { status: 401 }) }
  if (!account.is_admin) return { err: NextResponse.json({ error: "yalnızca yönetici" }, { status: 403 }) }
  return { account }
}

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { err } = await requireAdmin(supabase, request)
  if (err) return err
  const { data } = await supabase
    .from("app_accounts")
    .select("id, name, is_admin, must_change, created_at")
    .order("created_at", { ascending: true })
  return NextResponse.json({ users: data || [] })
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { err } = await requireAdmin(supabase, request)
  if (err) return err
  const { name } = await request.json().catch(() => ({}))
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "isim gerekli" }, { status: 400 })
  }
  // FS- oneki + 10 hex: telaffuzu kolay, tahmini zor
  const code = `FS-${crypto.randomBytes(5).toString("hex").toUpperCase()}`
  const { data, error } = await supabase
    .from("app_accounts")
    .insert({ name: name.trim(), code_hash: hashCode(code), is_admin: false, must_change: true })
    .select("id, name")
    .single()
  if (error) return NextResponse.json({ error: "eklenemedi" }, { status: 500 })
  return NextResponse.json({ ok: true, user: data, code }) // kod yalnizca bu cevapta
}

export async function DELETE(request: Request) {
  const supabase = await getSupabaseServerClient()
  const { account, err } = await requireAdmin(supabase, request)
  if (err) return err
  const { id } = await request.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 })
  if (String(id) === String(account.id)) return NextResponse.json({ error: "kendinizi silemezsiniz" }, { status: 400 })
  await supabase.from("app_accounts").delete().eq("id", id)
  return NextResponse.json({ ok: true })
}
