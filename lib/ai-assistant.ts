/* @ts-nocheck */

// ============================================================
// AI YONETICI — ChatPlace "AI yönetici" muadili
// Hicbir otomasyon/oyunlastirma komutu eslesmeyen DM'lere, panelden
// duzenlenen persona (iletisim kurallari) ile cevap verir.
//
// IKI MOD:
//  1) YEREL KOPRU (varsayilan, API anahtari GEREKMEZ): mesaj
//     webhook_events'e 'ai_pending' olarak kuyruklanir. Mac'te calisan
//     scripts/chatbot_kopru.py bunlari /api/chatbot/bridge'den ceker,
//     yerel Ollama ile cevabi uretir, ayni endpoint uzerinden gonderir.
//  2) API MODU: Vercel env'de ANTHROPIC_API_KEY varsa dogrudan Claude
//     API ile aninda cevaplanir (eski davranis).
//
// Politika (iki modda da): yalnizca gelen mesaja cevap verilir (24s
// penceresi acik), gunluk/saatlik limitler + devre kesici uygulanir.
// ============================================================

import { rateLimitCoolingDown, recordRateLimitHit, underHourlyLimit } from "@/lib/gamification"

const GRAPH = "https://graph.instagram.com/v24.0"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function getAiSettings(supabase: any, userId: any) {
  const { data } = await supabase.from("ai_settings").select("*").eq("user_id", userId).single()
  return data || null
}

// Son mesajlardan kisa konusma gecmisi (AI baglami icin)
async function recentHistory(supabase: any, userId: any, senderId: any, limit = 6) {
  const { data: convRows } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("recipient_id", String(senderId))
    .order("created_at", { ascending: true })
    .limit(1)
  const conv = convRows?.[0]
  if (!conv) return []
  const { data: msgs } = await supabase
    .from("messages")
    .select("content, is_from_instagram, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (!msgs?.length) return []
  // kronolojik siraya cevir; role: user = takipci, assistant = biz
  return msgs
    .reverse()
    .filter((m: any) => m.content)
    .map((m: any) => ({ role: m.is_from_instagram ? "user" : "assistant", content: String(m.content).slice(0, 500) }))
}

// true donerse mesaj AI tarafindan cevaplandi (otomasyon akisi durur)
export async function handleAiAssistant(ctx: {
  supabase: any
  user: any
  senderId: any
  text: string
  evKey: string
  claimEvent: (supabase: any, key: string, type: string, userId: any) => Promise<boolean>
  underDailyLimit: (supabase: any, userId: any) => Promise<boolean>
}): Promise<boolean> {
  const { supabase, user, senderId, text, evKey, claimEvent, underDailyLimit } = ctx

  const ai = await getAiSettings(supabase, user.id)
  if (!ai?.enabled || !ai.persona) return false
  if (!text || text.length < 2) return false

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // YEREL KOPRU MODU: kuyruga yaz, cevabi Mac'teki kopru scripti verecek.
    // event_type 'ai_pending' — limit sayaclari 'send%' filtreledigi icin karismaz.
    // evKey = mid_<mesaj-id>; bridge mesaji messages tablosundan bu id ile bulur.
    const queued = await claimEvent(supabase, `aiq_${evKey}`, "ai_pending", user.id)
    if (queued) console.log(`[v0] 📥 AI kuyruga eklendi (yerel kopru): aiq_${evKey}`)
    return true
  }

  // 1) Cevabi uret
  let reply: string | null = null
  try {
    const history = await recentHistory(supabase, user.id, senderId)
    // son gecmis mesaji zaten bu gelen mesajsa cikar (route mesaji DB'ye AI'dan once yazar)
    if (history.length && history[history.length - 1].role === "user") history.pop()
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ai.model || "claude-haiku-4-5-20251001",
        max_tokens: ai.max_tokens || 300,
        system:
          `${ai.persona}\n\n` +
          `TEKNIK KURALLAR: Yanıtın doğrudan Instagram DM olarak gönderilecek. ` +
          `Kısa tut (1-3 cümle), düz metin yaz, markdown/başlık/madde işareti kullanma. ` +
          `Emin olmadığın konuda bilgi uydurma.`,
        messages: [...(history || []), { role: "user", content: text.slice(0, 1000) }],
      }),
    })
    const j = await res.json()
    if (j?.error) {
      console.error("[v0] 🔴 AI yonetici API hatasi:", JSON.stringify(j.error))
      return false
    }
    reply = j?.content?.[0]?.text?.trim() || null
  } catch (e) {
    console.error("[v0] 🔴 AI yonetici cagri hatasi:", e)
    return false
  }
  if (!reply) return false

  // 2) Limitler + devre kesici + insani gecikme
  if (!(await underDailyLimit(supabase, user.id))) {
    console.log(`[v0] 🛑 Gunluk DM limiti doldu (${user.username}), AI cevabi atlandi`)
    return true
  }
  if (!(await underHourlyLimit(supabase, user.id))) {
    console.log(`[v0] 🛑 Saatlik DM limiti doldu (${user.username}), AI cevabi atlandi`)
    return true
  }
  if (await rateLimitCoolingDown(supabase, user.id)) {
    console.log(`[v0] 🧯 Rate sogutmasi aktif (${user.username}), AI cevabi atlandi`)
    return true
  }
  await claimEvent(supabase, `send_ai_${evKey}`, "send_dm", user.id)
  await sleep(2000 + Math.random() * 4000)

  // 3) Gonder + inbox'a kaydet
  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(user.access_token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: senderId }, message: { text: reply } }),
    })
    const json = await res.json()
    if (json.error) {
      console.error("[v0] 🔴 AI cevabi gonderilemedi:", JSON.stringify(json.error))
      await recordRateLimitHit(supabase, user.id, json.error)
      return true
    }
    console.log(`[v0] 🤖 AI yonetici cevap verdi → ${senderId}`)
    const { data: convRows } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user.id)
      .eq("recipient_id", String(senderId))
      .order("created_at", { ascending: true })
      .limit(1)
    const conv = convRows?.[0]
    if (conv) {
      await supabase.from("messages").insert({
        id: `mid_ai_${Date.now()}_${Math.random()}`,
        conversation_id: conv.id,
        user_id: user.id,
        sender_id: user.business_account_id,
        sender_username: user.username,
        content: reply,
        is_from_instagram: false,
      })
    }
  } catch (e) {
    console.error("[v0] 🔴 AI cevabi network hatasi:", e)
  }
  return true
}
