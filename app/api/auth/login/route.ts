/* @ts-nocheck */

// Panel girisi: ADMIN_PASSWORD dogruysa 7 gunluk imzali httpOnly cookie verir.

import { NextResponse } from "next/server"
import crypto from "crypto"

export async function POST(request: Request) {
  const pwd = process.env.ADMIN_PASSWORD
  if (!pwd) {
    return NextResponse.json({ ok: true, note: "ADMIN_PASSWORD tanimli degil — koruma kapali" })
  }
  const { password } = await request.json().catch(() => ({}))
  if (!password || password !== pwd) {
    return NextResponse.json({ error: "Şifre hatalı" }, { status: 401 })
  }
  const exp = String(Date.now() + 7 * 86400000)
  const sig = crypto.createHmac("sha256", pwd).update(exp).digest("hex")
  const res = NextResponse.json({ ok: true })
  res.cookies.set("ia_auth", `${exp}.${sig}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  })
  return res
}
