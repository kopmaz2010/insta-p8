/* @ts-nocheck */

// ============================================================
// COK KULLANICILI GIRIS (app_accounts)
// - Her kullanicinin bir ERISIM KODU var (scrypt hash'i DB'de; duz metin yok).
// - Giris: kod dogrulanir → ia_sess httpOnly cookie (accountId.exp.HMAC).
// - Sahiplik: users.owner_id → app_accounts.id; admin tum hesaplari gorur.
// Imza sirri: API_SECRET_KEY (hooks ile ayni env — yeni env gerektirmez).
// Bu dosya Node runtime icindir; middleware ayni imzayi WebCrypto ile dogrular.
// ============================================================

import crypto from "crypto"

const SESSION_DAYS = 7
export const SESSION_COOKIE = "ia_sess"

function secret(): string {
  return process.env.API_SECRET_KEY || ""
}

// --- kod hash'leme (scrypt, rastgele salt) ---
export function hashCode(code: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const h = crypto.scryptSync(code.normalize("NFC"), salt, 32).toString("hex")
  return `s2$${salt}$${h}`
}

export function verifyCode(code: string, stored: string): boolean {
  const m = /^s2\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(stored || "")
  if (!m) return false
  const h = crypto.scryptSync((code || "").normalize("NFC"), m[1], 32).toString("hex")
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(m[2]))
}

// --- oturum imzasi ---
export function signSession(accountId: string): string {
  const exp = String(Date.now() + SESSION_DAYS * 86400000)
  const sig = crypto.createHmac("sha256", secret()).update(`${accountId}.${exp}`).digest("hex")
  return `${accountId}.${exp}.${sig}`
}

export function readSessionId(cookieHeader: string): string | null {
  if (!secret()) return null
  const raw = (cookieHeader || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1)
  if (!raw) return null
  const parts = raw.split(".")
  if (parts.length !== 3) return null
  const [id, exp, sig] = parts
  if (Number(exp) < Date.now()) return null
  const expected = crypto.createHmac("sha256", secret()).update(`${id}.${exp}`).digest("hex")
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }
  return id
}

// Oturumdaki app_accounts kaydini getirir (yoksa null).
export async function getSessionAccount(supabase: any, request: Request): Promise<any | null> {
  const id = readSessionId(request.headers.get("cookie") || "")
  if (!id) return null
  const { data } = await supabase
    .from("app_accounts")
    .select("id, name, is_admin, must_change")
    .eq("id", id)
    .single()
  return data || null
}

// Panel API'leri icin sahiplik kapisi. igUserId (users.id) bu oturumun mu?
// Donus: { ok } veya { ok:false, status, error }. Admin her hesabi yonetir.
export async function requireOwner(supabase: any, request: Request, igUserId: any) {
  const account = await getSessionAccount(supabase, request)
  if (!account) return { ok: false, status: 401, error: "oturum yok — /giris" }
  if (account.is_admin) return { ok: true, account }
  if (!igUserId) return { ok: false, status: 400, error: "hesap belirtilmedi" }
  const { data, error } = await supabase
    .from("users")
    .select("owner_id")
    .eq("id", String(igUserId))
    .single()
  // FAIL-CLOSED: kayit yok/okunamadi → izin verme
  if (error || !data) return { ok: false, status: 403, error: "hesap bulunamadi" }
  if (String(data.owner_id) !== String(account.id))
    return { ok: false, status: 403, error: "bu hesap size ait değil" }
  return { ok: true, account }
}

export function ownerFilterId(account: any): string | null {
  // admin → null (filtre yok), digerleri → kendi id'si
  return account?.is_admin ? null : String(account?.id)
}
