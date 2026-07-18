/* @ts-nocheck */

// ============================================================
// CRON / DIS TETIKLEYICI KIMLIGI
// scheduler + cron uclari (VPS crontab, Vercel cron, GitHub Actions) buradan
// dogrulanir. GERIYE UYUMLU: `CRON_SECRET` env TANIMLI DEGILSE eski acik
// davranis surer (kurulum bozulmaz); tanimliysa istek su ucundan biriyle
// gizli tasimali olmali:
//   - Authorization: Bearer <CRON_SECRET>   (Vercel cron bunu OTOMATIK yollar)
//   - x-cron-secret: <CRON_SECRET>          (VPS crontab / GitHub Actions)
//   - ?secret=<CRON_SECRET>                 (basit curl)
// Sabit-zamanli karsilastirma.
// ============================================================

import crypto from "crypto"

function eq(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// Cron secret dogrula. Donus: { ok, configured }.
// configured=false → CRON_SECRET yok (acik mod).
export function checkCronSecret(request: Request): { ok: boolean; configured: boolean } {
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: true, configured: false } // geriye uyumlu acik mod

  const auth = request.headers.get("authorization") || ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (bearer && eq(bearer, secret)) return { ok: true, configured: true }

  const hdr = request.headers.get("x-cron-secret")
  if (hdr && eq(hdr, secret)) return { ok: true, configured: true }

  try {
    const qs = new URL(request.url).searchParams.get("secret")
    if (qs && eq(qs, secret)) return { ok: true, configured: true }
  } catch {}

  return { ok: false, configured: true }
}
