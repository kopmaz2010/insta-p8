/* @ts-nocheck */

// Panel girisi: ADMIN_PASSWORD dogruysa 7 gunluk imzali httpOnly cookie verir.
// GET: oturum durumu — dashboard layout'u bununla /giris yonlendirmesi yapar.

import { NextResponse } from "next/server"
import crypto from "crypto"

export async function GET(request: Request) {
  const pwd = process.env.ADMIN_PASSWORD
  if (!pwd) return NextResponse.json({ protected: false, authenticated: true })
  const cookieHeader = request.headers.get("cookie") || ""
  const raw = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("ia_auth="))?.slice(8)
  let authenticated = false
  if (raw) {
    const [exp, sig] = raw.split(".")
    if (exp && sig && Number(exp) > Date.now()) {
      const expected = crypto.createHmac("sha256", pwd).update(exp).digest("hex")
      authenticated = sig === expected
    }
  }
  return NextResponse.json({ protected: true, authenticated })
}

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
    // localhost/LAN (http) erisiminde Secure cookie dusuyor ve giris donguye
    // giriyordu — callback'teki insta_session ile ayni kosul kullanilir
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  })
  return res
}
