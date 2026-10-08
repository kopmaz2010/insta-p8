/* @ts-nocheck */

// ============================================================
// TIKTOK BUSINESS MESSAGING ISTEMCISI (8 Eki 2026)
// Kaynak: Chatwoot acik kaynak entegrasyonu (auth_client.rb, client.rb,
// tiktok_controller.rb) + bububa/tiktok-business Go SDK. TikTok'un resmi
// portali JS ile cizildigi icin dogrudan okunamadi; alanlar ilk gercek
// olayda `webhook_events.data` uzerinden dogrulanir.
//
// Env: TIKTOK_APP_ID (client_key), TIKTOK_APP_SECRET, TIKTOK_REDIRECT_URI
// Sinirlar (aracilardan): kullanici once yazmali; 48 saat / 10 mesaj; 10 QPS;
// Turkiye'de yalniz METIN; link tiklanmaz (duz yazilir). Hata 40100 = hiz,
// 40064 = mesajlasma kisiti → DUR.
// ============================================================

import crypto from "crypto"

const API = "https://business-api.tiktok.com/open_api/v1.3"
export const TIKTOK_SCOPES = [
  "user.info.basic", "user.info.username", "user.info.stats", "user.info.profile",
  "user.account.type", "user.insights",
  "message.list.read", "message.list.send", "message.list.manage",
]
export const TIKTOK_DUR_KODLARI = new Set([40100, 40064]) // hiz / kisit → gondermeyi durdur

function env(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`${k} tanimli degil`)
  return v
}

export function authorizeUrl(state: string): string {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize")
  u.searchParams.set("response_type", "code")
  u.searchParams.set("client_key", env("TIKTOK_APP_ID"))
  u.searchParams.set("redirect_uri", env("TIKTOK_REDIRECT_URI"))
  u.searchParams.set("scope", TIKTOK_SCOPES.join(","))
  u.searchParams.set("state", state)
  return u.toString()
}

async function jsonPost(url: string, body: any, headers: Record<string, string> = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let j: any
  try { j = JSON.parse(text) } catch { j = { code: -1, message: text.slice(0, 300) } }
  return { http: r.status, ...j }
}

export async function exchangeCode(code: string) {
  const j = await jsonPost(`${API}/tt_user/oauth2/token/`, {
    client_id: env("TIKTOK_APP_ID"),
    client_secret: env("TIKTOK_APP_SECRET"),
    grant_type: "authorization_code",
    auth_code: code,
    redirect_uri: env("TIKTOK_REDIRECT_URI"),
  })
  if (j.code !== 0 || !j.data?.access_token) throw new Error(`token: ${j.code} ${j.message}`)
  return tokenSatiri(j.data)
}

export async function refreshToken(refresh_token: string) {
  const j = await jsonPost(`${API}/tt_user/oauth2/refresh_token/`, {
    client_id: env("TIKTOK_APP_ID"),
    client_secret: env("TIKTOK_APP_SECRET"),
    grant_type: "refresh_token",
    refresh_token,
  })
  if (j.code !== 0 || !j.data?.access_token) throw new Error(`refresh: ${j.code} ${j.message}`)
  return tokenSatiri(j.data)
}

function tokenSatiri(d: any) {
  const now = Date.now()
  return {
    open_id: d.open_id,
    scope: d.scope,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(now + Number(d.expires_in || 0) * 1000).toISOString(),
    refresh_expires_at: new Date(now + Number(d.refresh_token_expires_in || 0) * 1000).toISOString(),
  }
}

// Kendi hesap bilgisi (username/display_name/profile_image)
export async function getBusiness(access_token: string, business_id: string) {
  const u = new URL(`${API}/business/get/`)
  u.searchParams.set("business_id", business_id)
  u.searchParams.set("fields", JSON.stringify(["username", "display_name", "profile_image"]))
  const r = await fetch(u, { headers: { "Access-Token": access_token, Accept: "application/json" } })
  const j = await r.json().catch(() => ({}))
  return j?.data || null
}

// Metin gonder (Turkiye: yalniz TEXT). Donus: { ok, message_id, code, message }
export async function sendText(access_token: string, business_id: string, conversation_id: string, body: string) {
  const j = await jsonPost(
    `${API}/business/message/send/`,
    { business_id, recipient_type: "CONVERSATION", recipient: conversation_id, message_type: "TEXT", text: { body } },
    { "Access-Token": access_token },
  )
  if (j.code === 0) return { ok: true, message_id: j.data?.message?.message_id || j.data?.message_id || null, code: 0, message: "" }
  return { ok: false, message_id: null, code: Number(j.code), message: String(j.message || "").slice(0, 200), http: j.http }
}

export async function listConversations(access_token: string, business_id: string, cursor?: string, conversation_type = "SINGLE") {
  const u = new URL(`${API}/business/message/conversation/list/`)
  u.searchParams.set("business_id", business_id)
  u.searchParams.set("conversation_type", conversation_type)
  u.searchParams.set("limit", "100")
  if (cursor) u.searchParams.set("cursor", cursor)
  const r = await fetch(u, { headers: { "Access-Token": access_token, Accept: "application/json" } })
  return r.json().catch(() => ({}))
}

// Webhook aboneligi: uygulama kimligiyle (token yok). callback_url = <origin>/api/tiktok/webhook
export async function webhookUpdate(callback_url: string) {
  return jsonPost(`${API}/business/webhook/update/`, {
    app_id: env("TIKTOK_APP_ID"), secret: env("TIKTOK_APP_SECRET"), event_type: "DIRECT_MESSAGE", callback_url,
  })
}
export async function webhookList() {
  const u = new URL(`${API}/business/webhook/list/`)
  u.searchParams.set("app_id", env("TIKTOK_APP_ID"))
  u.searchParams.set("secret", env("TIKTOK_APP_SECRET"))
  u.searchParams.set("event_type", "DIRECT_MESSAGE")
  const r = await fetch(u, { headers: { Accept: "application/json" } })
  return r.json().catch(() => ({}))
}

// Imza: header "Tiktok-Signature: t=<unix>,s=<hex>"; HMAC-SHA256(secret, "<t>.<rawBody>")
// Tolerans 300 sn (Chatwoot 5 sn kullanir; TikTok 72 saate kadar yeniden dener — yeniden
// denemede t yenilenmezse 5 sn hepsini reddeder; gevsek tutuldu, dedup zaten claim ile).
export function verifySignature(rawBody: string, header: string | null, toleransSn = 300): { ok: boolean; neden?: string } {
  const secret = process.env.TIKTOK_APP_SECRET
  if (!secret) return { ok: false, neden: "TIKTOK_APP_SECRET yok" }
  if (!header) return { ok: false, neden: "imza basligi yok" }
  const parts: Record<string, string> = {}
  for (const p of header.split(",")) { const [k, v] = p.trim().split("="); if (k && v) parts[k] = v }
  const t = Number(parts.t), s = parts.s
  if (!t || !s) return { ok: false, neden: "imza bicimi" }
  if (Math.abs(Date.now() / 1000 - t) > toleransSn) return { ok: false, neden: "zaman asimi" }
  const hesap = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")
  const a = Buffer.from(hesap), b = Buffer.from(s)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, neden: "imza uyusmuyor" }
  return { ok: true }
}

// OAuth state: "<user_id>.<hmac>" — callback'te hangi InstaAuto hesabina baglanacagini tasir
export function signState(userId: string): string {
  const mac = crypto.createHmac("sha256", env("TIKTOK_APP_SECRET")).update(`state:${userId}`).digest("hex").slice(0, 32)
  return `${userId}.${mac}`
}
export function readState(state: string | null): string | null {
  if (!state) return null
  const [userId, mac] = state.split(".")
  if (!userId || !mac) return null
  const bek = crypto.createHmac("sha256", env("TIKTOK_APP_SECRET")).update(`state:${userId}`).digest("hex").slice(0, 32)
  return mac === bek ? userId : null
}

// Gelen webhook zarfi: { client_key, event, create_time, user_openid, content:"<json>" }
// content (im_receive_msg): { conversation_id, message_id, timestamp, type, from_user:{id}, to_user:{id}, text:{body} }
export function parseEnvelope(body: any) {
  const event = String(body?.event || "")
  const user_openid = String(body?.user_openid || "")
  let content: any = body?.content
  if (typeof content === "string") { try { content = JSON.parse(content) } catch { content = { raw: content } } }
  return { event, user_openid, content: content || {}, create_time: body?.create_time ?? null, client_key: body?.client_key ?? null }
}
