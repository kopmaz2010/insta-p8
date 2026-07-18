/* @ts-nocheck */

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import crypto from "crypto"
import {
  awardCommentPoints,
  awardReactionPoints,
  awardStoryPoints,
  handleGamificationDM,
  isEmojiExpression,
  isOptedOut,
  rateLimitCoolingDown,
  recordRateLimitHit,
  underHourlyLimit,
} from "@/lib/gamification"
import { handleAiAssistant } from "@/lib/ai-assistant"

export const maxDuration = 60

const WEBHOOK_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "your_verify_token"
// SPAM (bkz. Vibe-Coding/INSTAGRAM-LIMIT-ARASTIRMASI.md): akis SADECE tetiklemeli
// (yorum -> cevap), soguk-DM degil; bu yuzden Katman 2'nin "100-150/gun soguk-DM"
// sezgisi degil, Katman 1'in resmi Private Reply tavani (750/saat = ~18.000/gun
// teorik) esas alinabilir. 5 Tem'de Ismail'in talebiyle 120 -> 1000/gun yukseltildi
// (viral gonderi patlamalarinda buyuk/koklu hesaplarin bu hacme rahat ulastigi
// gozlemlendi). RISK NOTU: bu gozlem koklu/yuksek-guvenli hesaplardan; Fabrika
// Muzik/ikopmaz o olcekte degilse ayni guven payini gormeyebilir. Devre kesici
// (rateLimitCoolingDown) gercek Meta rate hatasinda 30 dk otomatik durdurur —
// asil guvenlik agi budur, sabit sayi degil.
const DAILY_DM_LIMIT = Number(process.env.DAILY_DM_LIMIT || 1000)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// FAZ1-A4: Meta webhook imzasini dogrula (x-hub-signature-256)
// FAIL-CLOSED: secret yoksa REDDET (eski hali `return true` idi — imza
// dogrulamasi olmadan webhook'un tetiklenmesine izin veriyordu, boylece
// asagidaki `.or()` filtresine internetten deger enjekte edilebiliyordu).
// Prod'da INSTAGRAM_APP_SECRET set (canli test: imzasiz POST 403 aliyor).
function validSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.INSTAGRAM_APP_SECRET
  if (!secret) {
    console.error("[webhook] INSTAGRAM_APP_SECRET tanimsiz — imza dogrulanamiyor, reddedildi")
    return false
  }
  if (!header) return false
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// PostgREST filtre enjeksiyonu savunmasi: Instagram ID'leri yalnizca rakamdir.
// `.or("col.eq." + id)` template'ine gomulen id virgul/nokta/parantez icerirse
// filtre mantigi kaydirilabilir (baska hesabin satirina eslesme). Rakam-disi
// her degeri reddet — imza fail-open olsa bile bagimsiz ikinci savunma.
function numericId(v: any): string | null {
  const s = String(v ?? "")
  return /^\d{1,25}$/.test(s) ? s : null
}

// ============================================================
// TURKCE-DUYARLI ANAHTAR KELIME ESLESMESI
// Eski kod `\b` (word boundary) kullaniyordu — JS'te \b yalnizca ASCII
// kelime karakterlerini tanir; "takası" gibi Turkce harfle biten kelimeler
// HIC eslesmiyordu (iki kelimeli "Yetenek Takası" bug'inin koku buydu).
// Unicode lookaround (?<!\p{L}\p{N}) ... (?!\p{L}\p{N}) ile duzeltildi.
// ============================================================
// keywordMatches lib/tr-match'e tasindi — comment-poller ile TEK KAYNAK
import { keywordMatches } from "@/lib/tr-match"

// Hesap basina mesaj ozellestirmesi: public cevap varyasyonlari (maks 5)
// + takip kapisi karti metin/butonlari (dashboard > Özelleştirme'den yonetilir)
const DEFAULT_PUBLIC_REPLIES = ["DM'ne bak! 📩", "Gönderdim, DM'ni kontrol et! 🔥", "DM kutuna düştü! ✨"]
async function getDmCustomization(supabase: any, user: any) {
  let data: any = null
  try {
    const res = await supabase.from("dm_customization").select("*").eq("user_id", user.id).single()
    data = res.data
  } catch {}
  const replies = (data?.public_replies || []).filter((r: string) => r && r.trim()).slice(0, 5)
  return {
    publicReplies: replies.length ? replies : DEFAULT_PUBLIC_REPLIES,
    gateTitle: (data?.gate_title || "Takipcilere ozel icerik 🔒").slice(0, 80),
    gateSubtitle: (data?.gate_subtitle || "Once @{username} hesabini takip et, sonra butona bas!")
      .replaceAll("{username}", user.username)
      .slice(0, 80),
    gateBtnProfile: (data?.gate_btn_profile || "Profile Git").slice(0, 20),
    gateBtnFollow: (data?.gate_btn_follow || "TAKIP ETTIM 🙌").slice(0, 20),
  }
}

// FAZ1-A5: event'i sahiplen — ayni anahtar ikinci kez gelirse false (dedup)
async function claimEvent(supabase: any, key: string, type: string, userId: any): Promise<boolean> {
  const { error } = await supabase.from("webhook_events").insert({ event_key: key, event_type: type, user_id: userId })
  if (!error) return true
  if (error.code === "23505") return false // zaten islenmis
  console.error("[v0] claimEvent hatasi:", error)
  // Beklenmedik DB hatasi:
  //  - GELEN event (recv_*): FAIL-OPEN → mesaji isle. Aksi halde gecici bir DB
  //    hatasi kullanicinin mesajini SESSIZCE yutar ("quiz yazdim, hicbir sey olmadi").
  //    Cift cevap riski yok: her giden DM'in kendi send_* claim'i var, o fail-closed.
  //  - GIDEN claim (send_*): FAIL-CLOSED → gonderme. Dedup dogrulanamiyorsa cift DM riski alma.
  return type.startsWith("recv")
}

// FAZ1: hesap basina gunluk gonderim limiti
async function underDailyLimit(supabase: any, userId: any): Promise<boolean> {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from("webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .like("event_type", "send%")
    .gte("processed_at", dayStart.toISOString())
  if (error) {
    console.error("[v0] limit kontrol hatasi:", error)
    return false // FAIL-CLOSED: limit dogrulanamiyorsa gonderme
  }
  return (count || 0) < DAILY_DM_LIMIT
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: "Invalid token" }, { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    if (!validSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
      console.error("[v0] 🔴 Gecersiz webhook imzasi — reddedildi")
      return NextResponse.json({ error: "invalid signature" }, { status: 403 })
    }
    const body = JSON.parse(rawBody)
    if (!body.entry) return NextResponse.json({ ok: true })
    const supabase = await getSupabaseServerClient()

    for (const entry of body.entry) {
      // ============================================================
      // 🔇 ECHO SILENCER (The Fix for "ID Not Found" logs)
      // ============================================================
      // If the incoming event is just a "Read Receipt", "Delivery Status",
      // or "Echo" (the bot's own reply), we skip it immediately.
      // This prevents the code from trying to find a User ID for a system event.
      if (entry.messaging) {
        const isSystemEvent = entry.messaging.every(
          (event: any) => event.read || event.delivery || (event.message && event.message.is_echo),
        )
        if (isSystemEvent) {
          // console.log("[v0] 🔇 Skipped System Event (Echo/Read/Delivery)")
          continue
        }
      }
      // ============================================================

      const webhookId = entry.id
      const webhookIdSafe = numericId(webhookId)
      if (!webhookIdSafe) {
        console.warn(`[v0] ⚠️ Rakam-disi entry.id atlandi: ${String(webhookId).slice(0, 40)}`)
        continue
      }

      // 1. DUAL ID LOOKUP
      // id_s: users.id BIGINT'i 2^53'u asar — JSON number'a cevrilirken YUVARLANIR
      // (hayranimsinapp ...486 vakasi: automations sorgusu 0 donuyordu). id her
      // zaman ::text olarak da cekilir ve asagida user.id'ye yazilir.
      let { data: user } = await supabase
        .from("users")
        .select("*, id_s:id::text")
        .or(`business_account_id.eq.${webhookIdSafe},page_id.eq.${webhookIdSafe}`)
        .single()

      // ============================================================
      // 🔍 FALLBACK 1: Extract actual IG ID from payload
      // ============================================================
      if (!user) {
        console.log(`[v0] ⚠️ ID ${webhookId} not found in DB. Trying payload fallback...`)

        const candidateIds = new Set<string>()

        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value?.media?.owner?.id) candidateIds.add(String(change.value.media.owner.id))
          }
        }
        if (entry.messaging) {
          for (const event of entry.messaging) {
            if (event.recipient?.id) candidateIds.add(String(event.recipient.id))
          }
        }

        for (const candidateId of candidateIds) {
          if (candidateId === webhookId) continue
          const candSafe = numericId(candidateId)
          if (!candSafe) continue // rakam-disi payload id enjeksiyonu reddet
          const { data: fallbackUser } = await supabase
            .from("users")
            .select("*, id_s:id::text")
            .or(`business_account_id.eq.${candSafe},page_id.eq.${candSafe}`)
            .single()

          if (fallbackUser) {
            console.log(`[v0] ✅ Payload fallback matched! ${candidateId} → ${fallbackUser.username}`)
            await supabase.from("users").update({ page_id: webhookId }).eq("id", fallbackUser.id)
            user = fallbackUser
            break
          }
        }
      }

      // ============================================================
      // 🔍 FALLBACK 2: Token verification (tests ALL users)
      // Only runs once per unknown ID, then saves the mapping forever
      // ============================================================
      if (!user) {
        console.log(`[v0] 🔎 Trying token verification for ${webhookId}...`)
        const { data: allUsers } = await supabase.from("users").select("*, id_s:id::text")

        if (allUsers) {
          for (const candidate of allUsers) {
            if (!candidate.access_token) continue
            try {
              // KIMLIK DOGRULAMA: adayin KENDI /me kimligi webhook id'siyle
              // birebir ayni olmali. (Eski yontem GET /{webhookId} 200 donerse
              // sahiplenirdi — cok hesapli kurulumda yanlis hesaba eslenip
              // DM'lerin YANLIS hesaptan gitmesine yol acabilirdi.)
              const meRes = await fetch(
                `https://graph.instagram.com/v24.0/me?fields=user_id,username&access_token=${candidate.access_token}`
              )
              const meRaw = await meRes.text()
              const meUserId = /"user_id"\s*:\s*"?(\d+)"?/.exec(meRaw)?.[1]
              if (meRes.ok && meUserId === String(webhookId)) {
                console.log(`[v0] ✅ Identity verified! ${webhookId} = ${candidate.username}. Saving permanently.`)
                await supabase
                  .from("users")
                  .update({ page_id: webhookId })
                  .eq("id", candidate.id)
                user = candidate
                break
              }
            } catch (e) {
              // Network error, skip this user
            }
          }
        }
      }
      // ============================================================

      if (!user) {
        console.log(`[v0] ❌ Could not resolve User for ID ${webhookId}`)
        continue
      }
      // BIGINT hassasiyet fix'i: sorgularda kullanilacak id = kayipsiz text
      if (user.id_s) user.id = user.id_s

      const { data: automations } = await supabase
        .from("automations")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)

      if (!automations?.length) continue

      // ============================================================
      //  PART A: COMMENTS
      // ============================================================
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === "comments" && change.value?.text) {
            const commentId = change.value.id
            // TR-lowercase: duz toLowerCase() "TAKASI"yi "takasi" yapar (noktasiz i kaybi) — eslesme kacar
            const commentText = change.value.text.toLocaleLowerCase("tr").trim()
            const senderId = change.value.from.id

            const mediaId = change.value.media.id

            // IZLEME: Meta'dan yorum eventi GELDI mi sorusuna DB'den cevap —
            // self-comment dahil her yorum icin iz birakilir ("hic event yok mu,
            // yoksa kod mu atliyor" ayrimi loglara bakmadan yapilabilir).
            await claimEvent(supabase, `raw_comment_${commentId}`, "recv_comment_raw", user.id)

            // Safety check for self-reply
            if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

            // ============================================================
            // 🧠 SMART MATCHING LOGIC
            // ============================================================
            // Filter to comment-only automations first
            const commentAutomations = automations.filter((a: any) => a.trigger_source === 'comment')

            // Priority 1: Reply-All (Specific post, ALL comments)
            let match = commentAutomations.find(
              (a: any) => a.specific_media_id === mediaId && a.trigger_type === "reply_all",
            )

            // Priority 2: Specific Post + Keyword Match
            // (yalnizca comment kaynakli kurallar — DM/story kurallari yoruma ateslenmez)
            if (!match) {
              match = commentAutomations.find(
                (a) =>
                  a.specific_media_id === mediaId &&
                  a.trigger_type === "keyword" &&
                  keywordMatches(commentText, a.trigger_value),
              )
            }

            // Priority 3: Global Keyword Match (Only if no specific match found)
            if (!match) {
              match = commentAutomations.find(
                (a) =>
                  !a.specific_media_id && // Must be global
                  a.trigger_type === "keyword" &&
                  keywordMatches(commentText, a.trigger_value),
              )
            }

            if (match) {
              console.log(`[v0] ✅ Comment Match: "${match.name}" (ID: ${match.id})`)
              const content = match.response_content

              // --- FAZ1: ayni yorumu iki kez isleme (Meta retry korumasi) ---
              if (!(await claimEvent(supabase, `comment_${commentId}`, "recv_comment", user.id))) {
                console.log(`[v0] ⏭️ Tekrarlanan yorum eventi, atlandi: ${commentId}`)
                continue
              }
              // --- FAZ1: hesap bazli gunluk DM limiti ---
              if (!(await underDailyLimit(supabase, user.id))) {
                console.log(`[v0] 🛑 Gunluk DM limiti doldu (${user.username}), atlandi`)
                continue
              }
              // --- G1 POLITIKA: saatlik gonderim tavani ---
              if (!(await underHourlyLimit(supabase, user.id))) {
                console.log(`[v0] 🛑 Saatlik DM limiti doldu (${user.username}), atlandi`)
                continue
              }
              // --- G1 POLITIKA: DURDUR demis kullaniciya otomatik mesaj yok ---
              if (await isOptedOut(supabase, user.id, senderId)) {
                console.log(`[v0] ⏭️ Opt-out kullanici (${senderId}), yorum cevabi atlandi`)
                continue
              }
              // --- SPAM: devre kesici — yakin zamanda Meta rate hatasi varsa gonderme ---
              if (await rateLimitCoolingDown(supabase, user.id)) {
                console.log(`[v0] 🧯 Rate sogutmasi aktif (${user.username}), yorum cevabi atlandi`)
                continue
              }
              // Ozellestirilmis mesajlar (public cevaplar + takip kapisi karti)
              const cust = await getDmCustomization(supabase, user)

              // === GERCEK FOLLOW GATE (yorum tetiklemeli kurallar) ===
              if (content.check_follow === true) {
                let follows = false
                try {
                  const fr = await fetch(
                    `https://graph.instagram.com/v24.0/${senderId}?fields=is_user_follow_business&access_token=${encodeURIComponent(user.access_token)}`
                  )
                  const fj = await fr.json()
                  follows = fj.is_user_follow_business === true
                } catch (e) { console.error("[v0] follow check failed", e) }
                if (!follows) {
                  const gd = new Date().toISOString().slice(0, 10)
                  if (!(await claimEvent(supabase, `gate_${match.id}_${senderId}_${gd}`, "send_gate", user.id))) {
                    console.log(`[v0] ⏭️ Takip karti bugun zaten gitti: ${senderId}`)
                    continue
                  }
                  await sleep(1500 + Math.random() * 2500)

                  // FIX (10 Tem): gate dalinda public yorum cevabi HIC atilmiyordu —
                  // takipci olmayan yorumcular "cevapsiz" kaliyordu. Kart DM'iyle
                  // birlikte yoruma da public cevap gider.
                  try {
                    const gateReply = cust.publicReplies[Math.floor(Math.random() * cust.publicReplies.length)]
                    const pubRes = await fetch(
                      `https://graph.instagram.com/v24.0/${commentId}/replies?access_token=${encodeURIComponent(user.access_token)}`,
                      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: gateReply }) },
                    )
                    const pubJson = await pubRes.json()
                    if (pubJson.error) {
                      console.error("[v0] 🔴 Gate public reply failed:", JSON.stringify(pubJson.error))
                      await recordRateLimitHit(supabase, user.id, pubJson.error)
                    } else console.log("[v0] 🟢 Gate public reply sent!")
                  } catch (e) {
                    console.error("[v0] 🔴 Gate public reply network error:", e)
                  }
                  await sleep(800 + Math.random() * 1200)

                  try {
                    const gateRes = await fetch(
                      `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
                      { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ recipient: { comment_id: commentId },
                          message: { attachment: { type: "template", payload: { template_type: "generic", elements: [{
                            title: cust.gateTitle,
                            subtitle: cust.gateSubtitle,
                            buttons: [
                              { type: "web_url", url: `https://instagram.com/${user.username}`, title: cust.gateBtnProfile },
                              { type: "postback", title: cust.gateBtnFollow, payload: `UNLOCK_CONTENT_${match.id}` }
                            ]
                          }] } } } }) }
                    )
                    // cevabi oku: rate-limit hatalari devre kesiciyi beslesin
                    const gateJson = await gateRes.json()
                    if (gateJson.error) {
                      console.error("[v0] 🔴 Gate card DM failed:", JSON.stringify(gateJson.error))
                      await recordRateLimitHit(supabase, user.id, gateJson.error)
                    }
                  } catch (e) {
                    console.error("[v0] 🔴 Gate card DM network error:", e)
                  }
                  continue
                }
              }
              // === /FOLLOW GATE ===

              // --- G1: yoruma puan (benzersiz eylem + gunluk tavan + takip sarti) ---
              // once_ dedup'indan ONCE calisir: DM bugun zaten gittiyse bile farkli
              // gonderiye yapilan benzersiz yorum puan kazandirir (event_key korumali).
              const award = await awardCommentPoints({
                supabase,
                user,
                senderId,
                commentId,
                username: change.value.from?.username,
              })

              // --- FAZ1: ayni kisiye ayni kuraldan gunde 1 teslimat ---
              const dgun = new Date().toISOString().slice(0, 10)
              if (!(await claimEvent(supabase, `once_${match.id}_${senderId}_${dgun}`, "send_dm", user.id))) {
                console.log(`[v0] ⏭️ Bugun zaten teslim edildi (kural ${match.id} → ${senderId})`)
                continue
              }
              // --- FAZ1: insani gecikme ---
              await sleep(1500 + Math.random() * 2500)

              // Ozellestirilebilir public cevap varyasyonlari (dashboard > Özelleştirme, maks 5)
              let randomReply = cust.publicReplies[Math.floor(Math.random() * cust.publicReplies.length)]
              if (award) randomReply += ` ⭐ +${award.pts} puan kazandın, DM'den "PUAN" yaz!`

              // Public Reply
              try {
                const pubRes = await fetch(
                  `https://graph.instagram.com/v24.0/${commentId}/replies?access_token=${encodeURIComponent(user.access_token)}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: randomReply }),
                  },
                )
                const pubJson = await pubRes.json()
                if (pubJson.error) {
                  console.error("[v0] 🔴 Public Reply Failed:", JSON.stringify(pubJson.error))
                  await recordRateLimitHit(supabase, user.id, pubJson.error)
                } else console.log("[v0] 🟢 Public Reply Sent!", pubJson)
              } catch (e) {
                console.error("[v0] 🔴 Public Reply Network Error:", e)
              }

              await sleep(1500 + Math.random() * 2500)

              // Private Reply (DM)
              const apiBody: any = { recipient: { comment_id: commentId } }

              if (content.message) {
                // Plain Text
                let dmText = content.message
                // G2: ilk puanini kazanan uyeye karsilama notu
                if (award?.isFirst) {
                  dmText += `\n\n🎶 ${award.programName} programına hoş geldin! Bu yorumla +${award.pts} puan kazandın. Bakiyen için bana "PUAN", ödüller için "ÖDÜLLER" yazabilirsin.`
                }
                apiBody.message = { text: dmText }
              } else if (content.card) {
                // Rich Card / Generic Template
                const card = content.card
                const apiButtons = card.buttons.map((b: any) => ({
                  type: b.type,
                  title: b.title,
                  url: b.url || undefined,
                  payload: b.payload || undefined,
                }))
                const element: any = { title: card.title, buttons: apiButtons }
                if (card.subtitle) element.subtitle = card.subtitle
                if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url

                apiBody.message = {
                  attachment: {
                    type: "template",
                    payload: {
                      template_type: "generic",
                      elements: [element],
                    },
                  },
                }
              }

              console.log("[v0] 📤 DM Body:", JSON.stringify(apiBody))
              try {
                const dmRes = await fetch(
                  `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
                  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
                )
                const dmJson = await dmRes.json()
                if (dmJson.error) {
                  console.error("[v0] 🔴 Private DM Failed:", JSON.stringify(dmJson.error))
                  await recordRateLimitHit(supabase, user.id, dmJson.error)
                } else console.log("[v0] 🟢 Private DM Sent!", dmJson)
              } catch (e) {
                console.error("[v0] 🔴 Private DM Network Error:", e)
              }
            }
          }
        }
      }

      // ============================================================
      //  PART A.5: STORY AUTOMATION HANDLING
      // ============================================================
      // A.5'te eslesen story eventleri PART B'de TEKRAR islenmesin
      // (ayni kisiye ikinci DM gitmesin) — mid'leri burada topluyoruz
      const handledStoryMids = new Set<string>()
      if (entry.messaging) {
        for (const event of entry.messaging) {
          const senderId = event.sender.id
          const recipientId = event.recipient.id

          // Skip system events
          if (event.read || event.delivery || event.message?.is_echo || senderId === recipientId) continue

          if (event.reaction && event.reaction.action !== "unreact") {
            // G2b: mesaja/story'ye emoji tepkisi = ifade puani (kisi basi gunde 1)
            await awardReactionPoints({ supabase, user, senderId })
            // G2: story tepkisine ek puan (varsayilan KAPALI — settings.story_enabled;
            // Meta'nin 50k+ takipci sarti dogrulaninca acilacak)
            if (event.reaction.mid) {
              await awardStoryPoints({
                supabase,
                user,
                senderId,
                eventKey: `pt_story_${event.reaction.mid}_${senderId}`,
              })
            }
          }

          // Filter story automations only
          const storyAutomations = automations.filter((a: any) => a.trigger_source === 'story')
          if (storyAutomations.length === 0) continue

          let match = null
          let storyMediaId: string | null = null

          // 1️⃣ Story Mention Handler
          if (event.message?.attachments?.[0]?.type === 'story_mention') {
            const attachment = event.message.attachments[0]
            storyMediaId = attachment.payload?.url || null

            // Mention eventinde gercek story media id GELMEZ (payload.url CDN linki) —
            // spesifik-story kurali burada asla eslesemez; mention kurallari global calisir
            match = storyAutomations.find((a: any) =>
              a.trigger_type === 'mention' && !a.specific_media_id
            )
          }

          // 2️⃣ Story Reaction Handler  
          else if (event.reaction) {
            const reactionEmoji = event.reaction.emoji
            storyMediaId = event.reaction.mid || null

            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== 'reaction') return false
              // Reaction eventinde story media id yok (mid mesaj id'sidir) —
              // spesifik-story reaction kurali eslesemez; yalnizca global kurallar
              if (a.specific_media_id) return false

              const triggers = a.trigger_value?.split(',').map((t: string) => t.trim()) || []
              // 'ALL_REACTIONS' (UI'nin gonderdigi deger, kucuk harfe cevrilmis olabilir) = filtre yok
              const t0 = (triggers[0] || '').toUpperCase()
              if (triggers.length > 0 && t0 !== 'ALL' && t0 !== 'ALL_REACTIONS' && t0 !== '') {
                return triggers.includes(reactionEmoji)
              }
              return true
            })
          }

          // 3️⃣ Story Reply Handler
          else if (event.message?.reply_to?.story) {
            const messageText = event.message.text || ''
            storyMediaId = event.message.reply_to.story.id || null

            match = storyAutomations.find((a: any) => {
              if (a.trigger_type !== 'reply') return false
              if (a.specific_media_id && a.specific_media_id !== storyMediaId) return false

              const triggers = a.trigger_value?.split(',').map((t: string) => t.trim()) || []
              if (triggers.length > 0 && triggers[0] !== 'ALL' && triggers[0] !== 'ALL_MENTIONS' && triggers[0] !== '') {
                return keywordMatches(messageText, triggers.join(","))
              }
              return true
            })
          }

          // Send response if match found
          if (match) {
            console.log(`✨ Story automation matched: ${match.name}`)
            if (event.message?.mid) handledStoryMids.add(event.message.mid)

            // MADDE 3 (10-ACIK): story cevaplari da dedup + limit + devre kesici
            // zincirinden gecer (Meta retry'inda cift DM ve story flood'u engeller).
            // Anahtar mid/reaction-mid bazli: ayni event tekrar gelirse islenmez.
            const storyKey = `story_${match.id}_${senderId}_${event.message?.mid || event.reaction?.mid || event.timestamp}`
            if (!(await claimEvent(supabase, storyKey, "send_dm", user.id))) {
              console.log(`[v0] ⏭️ Story cevabi zaten gonderildi (retry), atlandi`)
              continue
            }
            if (!(await underDailyLimit(supabase, user.id))) {
              console.log(`[v0] 🛑 Gunluk DM limiti doldu (${user.username}), story cevabi atlandi`)
              continue
            }
            if (!(await underHourlyLimit(supabase, user.id))) {
              console.log(`[v0] 🛑 Saatlik DM limiti doldu (${user.username}), story cevabi atlandi`)
              continue
            }
            if (await isOptedOut(supabase, user.id, senderId)) {
              console.log(`[v0] ⏭️ Opt-out kullanici (${senderId}), story cevabi atlandi`)
              continue
            }
            if (await rateLimitCoolingDown(supabase, user.id)) {
              console.log(`[v0] 🧯 Rate sogutmasi aktif, story cevabi atlandi`)
              continue
            }
            await sleep(2000 + Math.random() * 4000)

            try {
              // Faz2 fix: response_content jsonb geldiginde JSON.parse patliyordu (story otomasyonlari bu yuzden bozuktu)
              const content =
                typeof match.response_content === "string" ? JSON.parse(match.response_content) : match.response_content
              const apiBody: any = { recipient: { id: senderId } }

              if (content.message) {
                apiBody.message = { text: content.message }
              } else if (content.card) {
                const card = content.card
                const apiButtons = card.buttons.map((b: any) => ({
                  type: b.type,
                  title: b.title,
                  url: b.url || undefined,
                  payload: b.payload || undefined,
                }))
                const element: any = { title: card.title, buttons: apiButtons }
                if (card.subtitle) element.subtitle = card.subtitle
                if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url

                apiBody.message = {
                  attachment: {
                    type: "template",
                    payload: {
                      template_type: "generic",
                      elements: [element],
                    },
                  },
                }
              }

              const storyRes = await fetch(
                `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
              )
              const storyJson = await storyRes.json()
              if (storyJson.error) {
                console.error(`[v0] 🔴 Story cevabi gonderilemedi:`, JSON.stringify(storyJson.error))
                await recordRateLimitHit(supabase, user.id, storyJson.error)
              } else console.log(`✅ Story automation sent: ${match.name}`)
            } catch (err) {
              console.error('❌ Story automation error:', err)
            }
          }
        }
      }

      // ============================================================
      //  PART B: MESSAGES (DMs)
      // ============================================================
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.read || event.delivery || event.reaction || event.message?.is_echo) continue
          // A.5'te story otomasyonu eslesen event — ikinci DM atma
          if (event.message?.mid && handledStoryMids.has(event.message.mid)) continue

          const senderId = event.sender.id
          if (senderId === webhookId || senderId === user.business_account_id || senderId === user.page_id) continue

          let triggerType = "",
            triggerValue = ""

          if (event.message?.quick_reply?.payload) {
            // G1: quick reply tiklamasi text olarak da gelir — payload oncelikli
            triggerType = "postback"
            triggerValue = event.message.quick_reply.payload
          } else if (event.message?.text) {
            triggerType = "keyword"
            triggerValue = event.message.text.toLocaleLowerCase("tr").trim()
          } else if (event.postback?.payload) {
            triggerType = "postback"
            triggerValue = event.postback.payload
          } else {
            continue
          }

          console.log(`[v0] 📩 DM from ${senderId}: "${triggerValue}"`)

          // --- FAZ1: ayni mesaj/postback eventini iki kez isleme ---
          const evKey = event.message?.mid ? `mid_${event.message.mid}` : `pb_${senderId}_${event.timestamp ?? Date.now()}`
          if (!(await claimEvent(supabase, evKey, "recv_dm", user.id))) {
            console.log(`[v0] ⏭️ Tekrarlanan DM eventi, atlandi`)
            continue
          }

          // ============================================================
          // 💾 1. SAVE INCOMING MESSAGE (Live Inbox Logic)
          // ============================================================
          try {
            // A. Upsert Conversation
            // We try to find an existing conv first to get the ID
            // NOT .single(): es zamanli iki DM ayni kisiden cift conversation
            // yaratabiliyor — .single() o durumda hata verip kaydi tamamen
            // engelliyordu. Ilk (en eski) kayit esas alinir.
            const { data: convRows } = await supabase
              .from("conversations")
              .select("id")
              .eq("user_id", user.id)
              .eq("recipient_id", senderId)
              .order("created_at", { ascending: true })
              .limit(1)
            let conv = convRows?.[0] || null

            if (!conv) {
              // Create new conversation

              // 1. Try to fetch real username first
              let realUsername = `cnt_${senderId.slice(0, 5)}...`
              try {
                const profileUrl = `https://graph.instagram.com/v24.0/${senderId}?fields=username&access_token=${user.access_token}`
                const profileRes = await fetch(profileUrl)
                const profileData = await profileRes.json()
                if (profileData.username) {
                  realUsername = profileData.username
                }
              } catch (e) {
                console.error("[v0] Failed to fetch username", e)
              }

              const { data: newConv } = await supabase
                .from("conversations")
                .insert({
                  user_id: user.id,
                  recipient_id: senderId,
                  recipient_username: realUsername,
                  last_message_at: new Date().toISOString(),
                })
                .select("id")
                .single()
              conv = newConv
            } else {
              // Update timestamp
              await supabase
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", conv.id)
            }

            if (conv) {
              // B. Save User Message
              await supabase.from("messages").insert({
                id: event.message?.mid || `mid_${Date.now()}_${Math.random()}`,
                conversation_id: conv.id,
                user_id: user.id,
                sender_id: senderId,
                sender_username: "User", // We don't have their username easily here
                content: triggerValue,
                is_from_instagram: true, // True = FROM the user TO us
              })
            }
          } catch (err) {
            console.error("[v0] Failed to save incoming message DB", err)
          }
          // ============================================================

          // ============================================================
          // ⭐ G1 OYUNLASTIRMA: PUAN/ÖDÜLLER/DURDUR komutlari + ODUL_/SHOW_ payload
          // ============================================================
          try {
            const gamiHandled = await handleGamificationDM({
              supabase,
              user,
              senderId,
              kind: triggerType === "postback" ? "payload" : "text",
              value: triggerValue,
              evKey,
              claimEvent,
              underDailyLimit,
            })
            if (gamiHandled) continue
          } catch (e) {
            console.error("[v0] Oyunlastirma handler hatasi:", e)
          }

          // --- G1 POLITIKA: DURDUR demis kullaniciya otomatik cevap yok ---
          if (await isOptedOut(supabase, user.id, senderId)) {
            console.log(`[v0] ⏭️ Opt-out kullanici (${senderId}), otomasyon cevabi atlandi`)
            continue
          }

          // --- G2b: emoji/hizli-ifade mesaji → kisi basi gunde 1 puan ---
          // (story hizli ifadeleri de metin olarak buraya duser)
          if (triggerType === "keyword" && isEmojiExpression(triggerValue)) {
            await awardReactionPoints({ supabase, user, senderId })
            continue
          }

          let match = null
          if (triggerType === "postback") {
            if (triggerValue.startsWith("UNLOCK_CONTENT_")) {
              const ruleId = triggerValue.replace("UNLOCK_CONTENT_", "")
              match = automations.find((a) => a.id === ruleId)
            } else if (triggerValue.startsWith("ICE_BREAKER_")) {
              // Handle Ice Breaker
              const iceBreakerId = triggerValue.replace("ICE_BREAKER_", "")
              const { data: ibMatches } = await supabase
                .from("ice_breakers")
                .select("*")
                .eq("id", iceBreakerId)
                .eq("user_id", user.id)
                .single()

              if (ibMatches) {
                // Construct a temporary match object to reuse the sending logic
                match = {
                  name: "Ice Breaker: " + ibMatches.question,
                  response_content: { message: ibMatches.response },
                }
              }
            } else {
              match = automations.find((a) => a.trigger_type === "postback" && a.trigger_value === triggerValue)
            }
          } else {
            // yalnizca DM kaynakli kurallar — comment/story kurallari DM'e ateslenmez
            match = automations.find(
              (a) => a.trigger_source === "dm" && a.trigger_type === "keyword" && keywordMatches(triggerValue, a.trigger_value),
            )
          }

          if (!match) {
            // 🤖 AI YONETICI (ChatPlace muadili): hicbir kural eslesmediyse
            // persona'li AI cevabi dene (panelden acik + ANTHROPIC_API_KEY gerekli)
            if (triggerType === "keyword" && event.message?.text) {
              try {
                const aiHandled = await handleAiAssistant({
                  supabase,
                  user,
                  senderId,
                  text: event.message.text,
                  evKey,
                  claimEvent,
                  underDailyLimit,
                })
                if (aiHandled) continue
              } catch (e) {
                console.error("[v0] AI yonetici hatasi:", e)
              }
            }
            console.log(`[v0] ❌ No match.`)
            continue
          }

          console.log(`[v0] ✅ Match: "${match.name}"`)
          const content = match.response_content
          const apiBody: any = { recipient: { id: senderId } }

          let replyTextLog = ""

          if (content.message) {
            apiBody.message = { text: content.message }
            replyTextLog = content.message
          } else if (content.card) {
            const card = content.card
            replyTextLog = `[Card] ${card.title}`
            const apiButtons = card.buttons.map((b: any) => ({
              type: b.type,
              title: b.title,
              url: b.url || undefined,
              payload: b.payload || undefined,
            }))
            const element: any = { title: card.title, buttons: apiButtons }
            if (card.subtitle) element.subtitle = card.subtitle
            if (card.image_url && card.image_url.startsWith("http")) element.image_url = card.image_url
            apiBody.message = {
              attachment: { type: "template", payload: { template_type: "generic", elements: [element] } },
            }
          }

                 // Follow Gate Logic (GERCEK takip kontrolu — butonda da dogrular)
          if (content.check_follow === true) {
            let follows = false
            try {
              const fr = await fetch(
                `https://graph.instagram.com/v24.0/${senderId}?fields=is_user_follow_business&access_token=${encodeURIComponent(user.access_token)}`
              )
              const fj = await fr.json()
              follows = fj.is_user_follow_business === true
            } catch (e) { console.error("[v0] follow check failed", e) }
            if (!follows) {
              const cust = await getDmCustomization(supabase, user)
              replyTextLog = "[Takip Kapisi]"
              apiBody.message = {
                attachment: {
                  type: "template",
                  payload: {
                    template_type: "generic",
                    elements: [
                      {
                        title: cust.gateTitle,
                        subtitle: cust.gateSubtitle,
                        buttons: [
                          { type: "web_url", url: `https://instagram.com/${user.username}`, title: cust.gateBtnProfile },
                          { type: "postback", title: cust.gateBtnFollow, payload: `UNLOCK_CONTENT_${match.id}` },
                        ],
                      },
                    ],
                  },
                },
              }
            }
          }
          // --- FAZ1: gunluk limit + insani gecikme ---
          if (!(await underDailyLimit(supabase, user.id))) {
            console.log(`[v0] 🛑 Gunluk DM limiti doldu (${user.username}), cevap atlandi`)
            continue
          }
          // --- G1 POLITIKA: saatlik gonderim tavani ---
          if (!(await underHourlyLimit(supabase, user.id))) {
            console.log(`[v0] 🛑 Saatlik DM limiti doldu (${user.username}), cevap atlandi`)
            continue
          }
          // --- SPAM: devre kesici ---
          if (await rateLimitCoolingDown(supabase, user.id)) {
            console.log(`[v0] 🧯 Rate sogutmasi aktif (${user.username}), cevap atlandi`)
            continue
          }
          await claimEvent(supabase, `send_${evKey}`, "send_dm", user.id)
          await sleep(2000 + Math.random() * 4000)

          // SEND REPLY
          try {
            const res = await fetch(
              `https://graph.instagram.com/v24.0/me/messages?access_token=${encodeURIComponent(user.access_token)}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apiBody) },
            )
            const json = await res.json()
            if (json.error) {
              console.error("[v0] 🔴 Reply Failed:", json.error)
              await recordRateLimitHit(supabase, user.id, json.error)
            } else {
              console.log("[v0] 🟢 Reply Sent!")

              // ============================================================
              // 💾 2. SAVE OUTGOING REPLY (Live Inbox Logic)
              // ============================================================
              // We need to find the conversation ID again (or pass it down)
              // For safety, we just re-query or use the one if we scoped it.
              // Doing a quick localized lookup for robustness:
              const { data: convRows2 } = await supabase
                .from("conversations")
                .select("id")
                .eq("user_id", user.id)
                .eq("recipient_id", senderId)
                .order("created_at", { ascending: true })
                .limit(1)
              const conv = convRows2?.[0] || null

              if (conv) {
                await supabase.from("messages").insert({
                  id: `mid_reply_${Date.now()}_${Math.random()}`,
                  conversation_id: conv.id,
                  user_id: user.id,
                  sender_id: user.business_account_id, // It's us
                  sender_username: user.username,
                  content: replyTextLog,
                  is_from_instagram: false, // False = FROM US
                })
              }
              // ============================================================
            }
          } catch (e) {
            console.error("[v0] Network Error:", e)
          }
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] Webhook Error", error)
    return NextResponse.json({ ok: true })
  }
}
