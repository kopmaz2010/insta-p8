/* @ts-nocheck */

// ============================================================
// CHATBOT YEREL KOPRU API'si
// Mac'te calisan scripts/chatbot_kopru.py bu iki ucu kullanir:
//   GET  → bekleyen (ai_pending) DM'ler + persona + konusma gecmisi
//   POST → uretilen cevabi gonder (limitler + devre kesici + dedup
//          BURADA uygulanir; script sadece metin uretir)
// Kimlik: x-api-secret === API_SECRET_KEY (hooks ile ayni mekanizma).
// 24 saat penceresi: 20 saatten eski bekleyenler cevaplanmaz,
// 'ai_expired' olarak isaretlenir (Meta 24h kurali guvenli tarafta).
// ============================================================

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getAiSettings } from "@/lib/ai-assistant"
import { rateLimitCoolingDown, recordRateLimitHit, underHourlyLimit } from "@/lib/gamification"

const GRAPH = "https://graph.instagram.com/v24.0"
const WINDOW_HOURS = 20
const DAILY_DM_LIMIT = Number(process.env.DAILY_DM_LIMIT || 150)

function authorized(request: NextRequest): boolean {
  const s = process.env.API_SECRET_KEY
  return Boolean(s) && request.headers.get("x-api-secret") === s
}

async function underDailyLimit(supabase: any, userId: any): Promise<boolean> {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from("webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .like("event_type", "send%")
    .gte("processed_at", dayStart.toISOString())
  if (error) return false // FAIL-CLOSED
  return (count || 0) < DAILY_DM_LIMIT
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const supabase = await getSupabaseServerClient()
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()

  // pencereyi kacirmis bekleyenleri kapat
  await supabase
    .from("webhook_events")
    .update({ event_type: "ai_expired" })
    .eq("event_type", "ai_pending")
    .lt("processed_at", cutoff)

  const { data: events } = await supabase
    .from("webhook_events")
    .select("event_key, user_id, processed_at")
    .eq("event_type", "ai_pending")
    .gte("processed_at", cutoff)
    .order("processed_at", { ascending: true })
    .limit(10)

  const pending: any[] = []
  for (const ev of events || []) {
    // event_key = aiq_mid_<mesaj-id>
    if (!ev.event_key?.startsWith("aiq_mid_")) continue
    const mid = ev.event_key.slice("aiq_mid_".length)
    const { data: msg } = await supabase
      .from("messages")
      .select("content, sender_id, conversation_id")
      .eq("id", mid)
      .single()
    if (!msg) continue
    const ai = await getAiSettings(supabase, ev.user_id)
    if (!ai?.enabled || !ai.persona) continue // bu arada kapatilmis olabilir

    const { data: msgs } = await supabase
      .from("messages")
      .select("id, content, is_from_instagram, created_at")
      .eq("conversation_id", msg.conversation_id)
      .order("created_at", { ascending: false })
      .limit(7)
    const history = (msgs || [])
      .reverse()
      .filter((m: any) => m.content && m.id !== mid) // gelen mesajin kendisi haric
      .map((m: any) => ({ role: m.is_from_instagram ? "user" : "assistant", content: String(m.content).slice(0, 500) }))

    pending.push({
      key: ev.event_key,
      userId: ev.user_id,
      text: String(msg.content).slice(0, 1000),
      history,
      persona: ai.persona,
      receivedAt: ev.processed_at,
    })
  }
  return NextResponse.json({ pending })
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { key, reply, action } = await request.json()
  if (!key?.startsWith("aiq_mid_")) return NextResponse.json({ error: "bad key" }, { status: 400 })
  const supabase = await getSupabaseServerClient()

  const { data: ev } = await supabase
    .from("webhook_events")
    .select("event_key, event_type, user_id, processed_at")
    .eq("event_key", key)
    .single()
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (ev.event_type !== "ai_pending") return NextResponse.json({ error: "already handled", state: ev.event_type }, { status: 409 })

  const mark = (t: string) =>
    supabase.from("webhook_events").update({ event_type: t }).eq("event_key", key).eq("event_type", "ai_pending")

  if (action === "skip") {
    await mark("ai_skipped")
    return NextResponse.json({ success: true, skipped: true })
  }
  if (!reply || typeof reply !== "string") return NextResponse.json({ error: "reply required" }, { status: 400 })

  // 24h penceresi (guvenli taraf: 20 saat)
  if (new Date(ev.processed_at).getTime() < Date.now() - WINDOW_HOURS * 3600_000) {
    await mark("ai_expired")
    return NextResponse.json({ error: "24h penceresi kapandi" }, { status: 410 })
  }

  const mid = key.slice("aiq_mid_".length)
  const { data: msg } = await supabase
    .from("messages")
    .select("sender_id, conversation_id")
    .eq("id", mid)
    .single()
  if (!msg) {
    await mark("ai_skipped")
    return NextResponse.json({ error: "mesaj bulunamadi" }, { status: 404 })
  }

  const { data: user } = await supabase.from("users").select("*").eq("id", ev.user_id).single()
  if (!user?.access_token) return NextResponse.json({ error: "hesap/token yok" }, { status: 404 })

  // limitler + devre kesici (her giden DM icin zorunlu)
  if (!(await underDailyLimit(supabase, user.id))) return NextResponse.json({ error: "gunluk limit doldu" }, { status: 429 })
  if (!(await underHourlyLimit(supabase, user.id))) return NextResponse.json({ error: "saatlik limit doldu" }, { status: 429 })
  if (await rateLimitCoolingDown(supabase, user.id)) return NextResponse.json({ error: "rate sogutmasi aktif" }, { status: 429 })

  // dedup: ayni bekleyen icin ikinci gonderimi engelle (kopru iki kez calissa bile)
  const { error: dupErr } = await supabase
    .from("webhook_events")
    .insert({ event_key: `send_ai_${key}`, event_type: "send_dm", user_id: user.id })
  if (dupErr?.code === "23505") return NextResponse.json({ error: "zaten gonderilmis" }, { status: 409 })

  const text = reply.trim().slice(0, 900)
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(user.access_token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: msg.sender_id }, message: { text } }),
  })
  const json = await res.json()
  if (json.error) {
    await recordRateLimitHit(supabase, user.id, json.error)
    await mark("ai_error")
    return NextResponse.json({ error: json.error.message || "Graph hatasi" }, { status: 502 })
  }

  await mark("ai_done")
  await supabase.from("messages").insert({
    id: `mid_ai_${Date.now()}_${Math.random()}`,
    conversation_id: msg.conversation_id,
    user_id: user.id,
    sender_id: user.business_account_id,
    sender_username: user.username,
    content: text,
    is_from_instagram: false,
  })
  console.log(`[v0] 🤖 Kopru cevabi gonderildi (${user.username}) → ${msg.sender_id}`)
  return NextResponse.json({ success: true })
}
