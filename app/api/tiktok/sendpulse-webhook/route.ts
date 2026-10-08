/* @ts-nocheck */

// ============================================================
// TIKTOK (SendPulse) WEBHOOK — Bora Duran TikTok DM otomasyonunun sicili.
//
// SendPulse "Bot Settings > Webhooks" global webhook'u buraya POST atar
// (gelen mesaj, giden mesaj, yeni abone, akis tetiklendi). Biz yalnizca
// SAYARIZ: her olay `webhook_events` tablosuna tt_* turuyle yazilir, boylece
// Bora'nin gunluk raporu ve ajans rakamlari TikTok'u da kapsar. Cevap gonderme
// SendPulse akisinin isi; buradan hicbir mesaj GONDERILMEZ.
//
// Guvenlik: SendPulse webhook'u imzalamaz. Bu yuzden URL'de gizli anahtar
// zorunlu:  POST /api/tiktok/sendpulse-webhook?secret=<SENDPULSE_WEBHOOK_SECRET>
// Env tanimli degilse uc KAPALIDIR (503) — acik mod yok, sahte sayim riski.
//
// Olay → event_type / event_key:
//   incoming_message → tt_recv_dm  / tt|<bot>|<contact>|<message_id>
//   outgoing_message → tt_send_dm  / tt|<bot>|<contact>|<message_id>
//   new_subscriber   → tt_new_sub  / tt|<bot>|<contact>|sub
//   run_custom_flow  → tt_flow     / tt|<bot>|<contact>|flow|<date>
// event_key benzersiz (23505 = tekrar teslim, sessizce gec).
//
// user_id: SENDPULSE_TIKTOK_BOT_MAP env'i {"<sendpulse bot id>": "<users.id>"}
// ile InstaAuto hesabina baglanir; eslesmeyen bot → TIKTOK_DEFAULT_USER_ID,
// o da yoksa olay kaydedilir ama user_id null kalir (rapor "bilinmeyen bot").
// NOT: tt_* turleri Instagram gunluk limit sayaclarina (event_type LIKE 'send%')
// girmez; Instagram davranisi degismez.
// ============================================================

import { NextResponse } from "next/server"
import crypto from "crypto"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export const maxDuration = 30

function eq(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function secretOk(request: Request): { ok: boolean; configured: boolean } {
  const secret = process.env.SENDPULSE_WEBHOOK_SECRET
  if (!secret) return { ok: false, configured: false }
  let qs = ""
  try { qs = new URL(request.url).searchParams.get("secret") || "" } catch {}
  const hdr = request.headers.get("x-webhook-secret") || ""
  return { ok: Boolean((qs && eq(qs, secret)) || (hdr && eq(hdr, secret))), configured: true }
}

function botUserId(botId: string): string | null {
  try {
    const map = JSON.parse(process.env.SENDPULSE_TIKTOK_BOT_MAP || "{}")
    if (map[botId]) return String(map[botId])
  } catch {}
  return process.env.TIKTOK_DEFAULT_USER_ID || null
}

// Gelen metin: info.message.channel_data.message.text.body (SendPulse belgesi);
// giden metin: info.message.channel_data.message.text (duz string). Ikisini de kapsa.
function metinCikar(ev: any): string {
  const m = ev?.info?.message?.channel_data?.message
  if (!m) return ""
  if (typeof m.text === "string") return m.text
  if (m.text && typeof m.text.body === "string") return m.text.body
  if (typeof m.body === "string") return m.body
  return ""
}

function mesajId(ev: any): string {
  return String(
    ev?.info?.message?.channel_data?.message_id ??
    ev?.info?.message?.id ??
    ev?.info?.message?.channel_data?.message?.id ??
    ""
  )
}

function olayiCevir(ev: any) {
  const title = String(ev?.title || "")
  const botId = String(ev?.bot?.id || "")
  const contactId = String(ev?.contact?.id || "")
  if (!botId || !contactId) return null
  const base = `tt|${botId}|${contactId}`
  const ozet = {
    service: ev?.service || null,
    title,
    bot_id: botId,
    bot_name: ev?.bot?.name || null,
    contact_id: contactId,
    contact_name: ev?.contact?.name || ev?.contact?.username || null,
    text: metinCikar(ev).slice(0, 500),
    date: ev?.date ?? null,
  }
  switch (title) {
    case "incoming_message": {
      const mid = mesajId(ev) || `${ev?.date ?? Date.now()}`
      return { event_type: "tt_recv_dm", event_key: `${base}|${mid}`, data: ozet }
    }
    case "outgoing_message": {
      const mid = mesajId(ev) || `${ev?.date ?? Date.now()}`
      return { event_type: "tt_send_dm", event_key: `${base}|${mid}`, data: ozet }
    }
    case "new_subscriber":
      return { event_type: "tt_new_sub", event_key: `${base}|sub`, data: ozet }
    case "run_custom_flow":
      return { event_type: "tt_flow", event_key: `${base}|flow|${ev?.date ?? Date.now()}`, data: ozet }
    default:
      // bilinmeyen olay turu: yine de sakla (title'i tur adina koy), ileride ayristirilir
      return { event_type: `tt_${title.replace(/[^a-z0-9_]/gi, "_").slice(0, 40) || "unknown"}`, event_key: `${base}|${title}|${ev?.date ?? Date.now()}`, data: ozet }
  }
}

export async function POST(request: Request) {
  const s = secretOk(request)
  if (!s.configured) return NextResponse.json({ error: "SENDPULSE_WEBHOOK_SECRET tanimli degil" }, { status: 503 })
  if (!s.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: "json bekleniyor" }, { status: 400 }) }
  const olaylar: any[] = Array.isArray(body) ? body : body ? [body] : []
  if (olaylar.length === 0) return NextResponse.json({ ok: true, kaydedilen: 0 })

  const supabase = await getSupabaseServerClient()
  let kaydedilen = 0, tekrar = 0, atlanan = 0
  for (const ev of olaylar.slice(0, 100)) {
    const satir = olayiCevir(ev)
    if (!satir) { atlanan++; continue }
    const user_id = botUserId(satir.data.bot_id)
    const { error } = await supabase.from("webhook_events").insert({
      event_key: satir.event_key,
      event_type: satir.event_type,
      user_id,
      data: satir.data,
    })
    if (!error) { kaydedilen++; continue }
    if (error.code === "23505") { tekrar++; continue } // ayni olay ikinci kez teslim edildi
    console.error("[tiktok-webhook] insert hatasi:", error.code, error.message)
    atlanan++
  }
  // SendPulse 2xx disinda yeniden dener; DB hatasinda bile 200 don (sonsuz tekrar olmasin), log yeter.
  return NextResponse.json({ ok: true, kaydedilen, tekrar, atlanan })
}

// Kurulum kontrolu: tarayicidan ?secret=... ile acilinca ucun ayakta oldugunu soyler.
export async function GET(request: Request) {
  const s = secretOk(request)
  if (!s.configured) return NextResponse.json({ ok: false, error: "SENDPULSE_WEBHOOK_SECRET tanimli degil" }, { status: 503 })
  if (!s.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  return NextResponse.json({ ok: true, uc: "tiktok/sendpulse-webhook", bot_map: !!process.env.SENDPULSE_TIKTOK_BOT_MAP, default_user: !!process.env.TIKTOK_DEFAULT_USER_ID })
}
