/* @ts-nocheck */

// Erisim kodunu degistir (oturum gerekli — middleware koruyor).
// Kod = sifre: tek alanli giris oldugu icin BENZERSIZ olmali;
// baska bir hesabin koduyla cakisirsa reddedilir (aksi halde o hesaba giris yapilirdi).

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getSessionAccount, verifyCode, hashCode } from "@/lib/app-auth"

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient()
  const account = await getSessionAccount(supabase, request)
  if (!account) return NextResponse.json({ error: "oturum yok" }, { status: 401 })

  const { newCode } = await request.json().catch(() => ({}))
  if (!newCode || typeof newCode !== "string" || newCode.trim().length < 6) {
    return NextResponse.json({ error: "Yeni kod en az 6 karakter olmalı" }, { status: 400 })
  }
  const code = newCode.trim()

  const { data: all, error } = await supabase.from("app_accounts").select("id, code_hash")
  if (error) return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 })
  const clash = (all || []).find((a: any) => String(a.id) !== String(account.id) && verifyCode(code, a.code_hash))
  if (clash) return NextResponse.json({ error: "Bu kod kullanılamaz, farklı bir kod seçin" }, { status: 409 })

  const { error: upErr } = await supabase
    .from("app_accounts")
    .update({ code_hash: hashCode(code), must_change: false })
    .eq("id", account.id)
  if (upErr) return NextResponse.json({ error: "Kaydedilemedi" }, { status: 500 })

  return NextResponse.json({ ok: true })
}
