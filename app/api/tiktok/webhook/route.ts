/* @ts-nocheck */

// ============================================================
// TIKTOK DM WEBHOOK — kendi sistemimiz (SendPulse'suz). 8 Eki 2026
//
// TikTok, DIRECT_MESSAGE olaylarini buraya POST eder (imza: Tiktok-Signature).
// Akis: imza → zarf → yalniz im_receive_msg → hesap (tiktok_accounts.open_id)
// → claim tt_recv → aktif tiktok_dm kurallari → Turkce anahtar kelime eslesmesi
// (lib/tr-match, Instagram ile AYNI motor) → kisi+kural+gun basina tek cevap
// → metin gonder → sicil tt_send_dm.
//
// Instagram'dan farklar: ses dosyasi yok (metin icinde ses sayfasi linki),
// yorum tetikleyici yok, takip kapisi yok. Hata 40100/40064 → o hesap icin
// 10 dk gonderim durur (devre kesici), olay yine sicile yazilir.
// 200 hemen doner; is `after()` icinde (TikTok 72 saat yeniden dener, dedup claim ile).
// ============================================================

import { NextResponse, after } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { keywordMatches } from "@/lib/tr-match"
import { verifySignature, parseEnvelope, sendText, TIKTOK_DUR_KODLARI } from "@/lib/tiktok"

export const maxDuration = 60

const GUNLUK_TAVAN = Math.max(Number(process.env.TIKTOK_DAILY_LIMIT) || 5000, 1)
const kuralOnbellek = new Map<string, { t: number; data: any[] }>()
const devreKesici = new Map<string, number>() // open_id → serbest kalma zamani (ms)

async function tiktokKurallari(supabase: any, userId: any): Promise<any[]> {
  const k = String(userId)
  const c = kuralOnbellek.get(k)
  if (c && Date.now() - c.t < 60_000) return c.data
  const { data } = await supabase
    .from("automations")
    .select("id, name, trigger_type, trigger_value, response_content, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("trigger_source", "tiktok_dm")
  const list = data || []
  kuralOnbellek.set(k, { t: Date.now(), data: list })
  return list
}

async function claim(supabase: any, key: string, type: string, userId: any, data?: any): Promise<boolean> {
  const { error } = await supabase.from("webhook_events").insert({ event_key: key, event_type: type, user_id: userId, data: data ?? null })
  if (!error) return true
  if (error.code === "23505") return false
  console.error("[tiktok] claim hatasi:", error.code, error.message)
  return type.startsWith("tt_recv") // gelen: fail-open, giden: fail-closed (Instagram ile ayni ilke)
}

async function gunlukSayi(supabase: any, userId: any): Promise<number> {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0)
  const { count } = await supabase
    .from("webhook_events").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("event_type", "tt_send_dm").gte("processed_at", d.toISOString())
  return count || 0
}

function metniHazirla(rc: any): string {
  if (!rc) return ""
  if (typeof rc === "string") return rc
  let m = String(rc.message || rc.text || "")
  // Instagram kurali kopyalanmissa ses kartini metne cevir: ses sayfasi linki
  if (rc.ses_sayfasi && !m.includes(rc.ses_sayfasi)) m = `${m}\n${rc.ses_sayfasi}`.trim()
  return m.slice(0, 6000)
}

export async function POST(request: Request) {
  const raw = await request.text()
  const imza = verifySignature(raw, request.headers.get("tiktok-signature"))
  if (!imza.ok) {
    console.warn("[tiktok] imza reddedildi:", imza.neden)
    return NextResponse.json({ error: imza.neden }, { status: imza.neden?.includes("SECRET") ? 503 : 401 })
  }
  let body: any
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: "json" }, { status: 400 }) }

  after(async () => {
    try { await olayIsle(body) } catch (e) { console.error("[tiktok] olay hatasi:", e) }
  })
  return NextResponse.json({ ok: true })
}

async function olayIsle(body: any) {
  const { event, user_openid, content } = parseEnvelope(body)
  if (event !== "im_receive_msg") return // echo (im_send_msg) ve okundu olaylari sayilmaz
  if (!user_openid) return
  const supabase = await getSupabaseServerClient()

  const { data: hesap } = await supabase
    .from("tiktok_accounts")
    .select("open_id, user_id::text, access_token, is_active, username")
    .eq("open_id", user_openid)
    .maybeSingle()
  if (!hesap) { console.warn("[tiktok] bagli olmayan hesap:", user_openid); return }

  const fromId = String(content?.from_user?.id || "")
  const convId = String(content?.conversation_id || "")
  const msgId = String(content?.message_id || `${content?.timestamp || Date.now()}`)
  const text = String(content?.text?.body ?? content?.text ?? "")
  if (!fromId || !convId) return
  if (fromId === user_openid) return // kendi mesajimiz

  const ozet = { contact_id: fromId, conversation_id: convId, message_id: msgId, text: text.slice(0, 500), type: content?.type || null, username: hesap.username }
  if (!(await claim(supabase, `tt_recv|${user_openid}|${msgId}`, "tt_recv_dm", hesap.user_id, ozet))) return // tekrar teslim
  if (!hesap.is_active || !hesap.access_token) return
  if (!text) return

  // devre kesici
  const serbest = devreKesici.get(user_openid) || 0
  if (Date.now() < serbest) return

  const kurallar = await tiktokKurallari(supabase, hesap.user_id)
  const kural = kurallar.find((k) =>
    k.trigger_type === "reply_all" || (k.trigger_type === "keyword" && keywordMatches(text, k.trigger_value || "")),
  )
  if (!kural) return

  const gun = new Date().toISOString().slice(0, 10)
  if (!(await claim(supabase, `tt_once|${kural.id}|${fromId}|${gun}`, "tt_once", hesap.user_id))) return // bugun aldi
  if ((await gunlukSayi(supabase, hesap.user_id)) >= GUNLUK_TAVAN) { console.warn("[tiktok] gunluk tavan:", hesap.user_id); return }

  const metin = metniHazirla(kural.response_content)
  if (!metin) return
  const r = await sendText(hesap.access_token, user_openid, convId, metin)
  if (r.ok) {
    await claim(supabase, `tt_send|${user_openid}|${msgId}`, "tt_send_dm", hesap.user_id,
      { contact_id: fromId, conversation_id: convId, rule_id: kural.id, rule: kural.name, text: metin.slice(0, 500), sent_message_id: r.message_id })
    return
  }
  console.error("[tiktok] gonderim hatasi:", r.code, r.message)
  await claim(supabase, `tt_err|${user_openid}|${msgId}`, TIKTOK_DUR_KODLARI.has(r.code) ? "tt_rate" : "tt_err", hesap.user_id,
    { contact_id: fromId, conversation_id: convId, rule_id: kural.id, code: r.code, message: r.message })
  if (TIKTOK_DUR_KODLARI.has(r.code)) devreKesici.set(user_openid, Date.now() + 10 * 60_000)
  if (r.code === 40105 || r.code === 40102) console.error("[tiktok] token gecersiz — cron/tiktok-refresh calismali")
}

// TikTok dogrulama el sikismasi belgelenmemis; GET'e 200 don (bazi panolar URL'yi GET ile yoklar)
export async function GET() {
  return NextResponse.json({ ok: true, uc: "tiktok/webhook" })
}
