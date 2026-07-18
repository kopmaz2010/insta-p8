/* @ts-nocheck */

// ============================================================
// SSRF-GUVENLI MEDYA FETCH
// "Instagram'dan ice aktar" akisi kullanicinin verdigi bir URL'yi sunucuda
// indirir. Dogrulama olmadan bu, ic aglara/metadata endpoint'ine (169.254.169.254,
// localhost, Supabase ic host) yonlendirilebilir bir SSRF olurdu. Kural:
//   - yalnizca https
//   - host yalnizca Instagram/Facebook CDN (allowlist)
//   - redirect'leri elle ele al (allowlist host redirect ile ic hedefe kacamasin)
// ============================================================

const ALLOWED_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"]

export function isAllowedMediaUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(String(raw))
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  const host = url.hostname.toLowerCase()
  return ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))
}

// Allowlist host'a https GET; redirect'leri manuel ele alir ve her adimda
// hedefi yeniden dogrular (en fazla 3 atlama). Reddedilirse hata firlatir.
export async function safeMediaFetch(raw: string, maxHops = 3): Promise<Response> {
  let target = raw
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isAllowedMediaUrl(target)) {
      throw new Error("İzin verilmeyen medya URL'i (yalnızca Instagram/Facebook CDN, https)")
    }
    const res = await fetch(target, { redirect: "manual" })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location")
      if (!loc) throw new Error("Yönlendirme hedefi yok")
      target = new URL(loc, target).toString() // sonraki turda yeniden dogrulanir
      continue
    }
    return res
  }
  throw new Error("Çok fazla yönlendirme")
}
