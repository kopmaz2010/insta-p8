/* @ts-nocheck */

// ============================================================
// MADDE 1 (10-ACIK): PANEL API KORUMASI
// ADMIN_PASSWORD env'i tanimliysa tum panel API'leri imzali cookie ister
// (/giris sayfasindan sifreyle alinir). Env tanimli DEGILSE eski davranis
// surer (kurulum bozulmaz) — handoff'ta uyari var.
// Webhook/OAuth/cron/hooks kendi mekanizmalariyla korundugu icin muaf.
// ============================================================

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC_PREFIXES = [
  "/api/instagram/webhook",  // Meta imza dogrulamasi kendi icinde
  "/api/instagram/callback", // OAuth donusu
  "/api/cron/",              // Vercel cron + GitHub Actions (opsiyonel CRON_SECRET)
  "/api/hooks/",             // x-api-secret ile korunuyor
  "/api/auth/login",         // giris ucu
]

async function hasValidCookie(req: NextRequest, secret: string): Promise<boolean> {
  const raw = req.cookies.get("ia_auth")?.value
  if (!raw) return false
  const [exp, sig] = raw.split(".")
  if (!exp || !sig) return false
  if (Number(exp) < Date.now()) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(exp))
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("")
  return hex === sig
}

export async function middleware(req: NextRequest) {
  const pwd = process.env.ADMIN_PASSWORD
  if (!pwd) return NextResponse.next() // koruma kurulmamis

  const { pathname } = req.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()

  if (await hasValidCookie(req, pwd)) return NextResponse.next()
  return NextResponse.json({ error: "unauthorized — /giris sayfasindan oturum acin" }, { status: 401 })
}

export const config = {
  matcher: ["/api/:path*"],
}
