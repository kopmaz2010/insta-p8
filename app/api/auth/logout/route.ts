/* @ts-nocheck */

// Oturumu kapat: ia_sess cookie'sini sil.

import { NextResponse } from "next/server"
import { SESSION_COOKIE } from "@/lib/app-auth"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
