/* @ts-nocheck */

// ============================================================
// PANEL API KORUMASI — COK KULLANICILI
// Tum panel API'leri ia_sess (accountId.exp.HMAC) cookie'si ister.
// Kod girisi /giris sayfasindan yapilir (app_accounts + scrypt).
// Imza sirri API_SECRET_KEY — hooks'la ayni env. Env YOKSA eski acik
// davranis surer (kurulum bozulmaz) ama canli ortamda env tanimli.
// Webhook/OAuth/cron/hooks kendi mekanizmalariyla korundugu icin muaf.
// Sahiplik (hangi hesap kimin) kontrolu route icinde requireOwner ile.
// ============================================================

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC_PREFIXES = [
  "/api/instagram/webhook",  // Meta imza dogrulamasi kendi icinde
  "/api/instagram/callback", // OAuth donusu (owner atamasi route icinde cookie'den)
  "/api/cron/",              // Vercel cron + GitHub Actions (opsiyonel CRON_SECRET)
  "/api/hooks/",             // x-api-secret ile korunuyor
  "/api/chatbot/bridge",     // x-api-secret ile korunuyor (yerel kopru)
  "/api/auth/login",         // giris ucu
  "/api/auth/logout",
]

// Tam-eslesme muafiyeti: /api/scheduler dis cron ile tetiklenir (GET, deterministik).
// startsWith KULLANILMAZ — /api/scheduler/config ve /pool panel API'sidir, korunur.
const PUBLIC_EXACT = ["/api/scheduler"]

// Middleware yalnizca imza+sure gecerliligini kontrol eder (hizli ilk kapi).
// Oturum iptali/rotation (sess_ver) DB'ye bakan getSessionAccount'ta uygulanir;
// tum veri erisimi oradan gectigi icin iptal edilmis oturum veri goremez.
async function hasValidSession(req: NextRequest, secret: string): Promise<boolean> {
  const raw = req.cookies.get("ia_sess")?.value
  if (!raw) return false
  const parts = raw.split(".")
  if (parts.length !== 4) return false
  const [id, exp, ver, sig] = parts
  if (!id || !exp || !ver || !sig || Number(exp) < Date.now()) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${exp}.${ver}`))
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("")
  return timingSafeEqualHex(hex, sig)
}

// Sabit-zamanli hex karsilastirma (Edge runtime — Node crypto yok).
// Duz `===` erken cikar ve imza tahmininde zaman sizdirir.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function middleware(req: NextRequest) {
  const secret = process.env.API_SECRET_KEY
  if (!secret) {
    // PROD'da fail-CLOSED: secret yoksa (env kazasi) tum panel API'sini ac BIRAKMA
    // — service_role RLS'i bypass ettigi icin acik kalirsa tum veri sizar.
    // Yalnizca yerel gelistirmede (production degil) eski acik davranis surer.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "server misconfigured" }, { status: 503 })
    }
    return NextResponse.next()
  }

  const { pathname } = req.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()
  if (PUBLIC_EXACT.includes(pathname)) return NextResponse.next()

  if (await hasValidSession(req, secret)) return NextResponse.next()
  return NextResponse.json({ error: "unauthorized — /giris sayfasindan oturum acin" }, { status: 401 })
}

export const config = {
  matcher: ["/api/:path*"],
}
