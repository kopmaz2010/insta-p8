/* @ts-nocheck */

// ============================================================
// OYUNLASTIRMA — Fabrika Puan sadakat sistemi (G1 + G2)
// Bucket-model puan katmani (bkz. Vibe-Coding/OYUNLASTIRMA-PLANI.md)
// Faz 1 guvenlik desenlerinin (event dedup, gunluk limit) ustune oturur.
// G2: quizbot, referral, liderlik tablosu, ilk-puan karsilama, story puani
// ============================================================

const GRAPH = "https://graph.instagram.com/v24.0"
const HOURLY_DM_LIMIT = Number(process.env.HOURLY_DM_LIMIT || 40) // Meta ~200/saat sinirinin cok altinda
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://project-80xl4-kopmaz2010s-projects.vercel.app"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Turkce komut normalizasyonu: "PUANIM", "Ödüller", "puanım" hepsi eslesir
export function normalizeCommand(text: string): string {
  return (text || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .trim()
}

// Hesap icin oyunlastirma acik mi? Kapaliysa null doner ve tum katman sessizce devre disi kalir.
export async function getGamificationSettings(supabase: any, userId: any) {
  const { data } = await supabase.from("gamification_settings").select("*").eq("user_id", userId).single()
  if (!data || data.active !== true) return null
  return data
}

// IGSID -> uye kaydi (yoksa olustur). Puan dogrulanmis IGSID'ye baglanir (multi-accounting korumasi).
export async function resolveMember(supabase: any, userId: any, igsid: any, username: string | null = null) {
  const igsidStr = String(igsid)
  const { data: existing } = await supabase
    .from("loyalty_members")
    .select("*")
    .eq("user_id", userId)
    .eq("igsid", igsidStr)
    .single()
  if (existing) {
    if (username && !existing.username) {
      await supabase.from("loyalty_members").update({ username }).eq("id", existing.id)
    }
    return existing
  }
  const { data: created, error } = await supabase
    .from("loyalty_members")
    .insert({ user_id: userId, igsid: igsidStr, username })
    .select("*")
    .single()
  if (error) {
    if (error.code === "23505") {
      // es zamanli iki webhook ayni uyeyi olusturmaya calisti — mevcut olani al
      const { data: again } = await supabase
        .from("loyalty_members")
        .select("*")
        .eq("user_id", userId)
        .eq("igsid", igsidStr)
        .single()
      return again
    }
    console.error("[v0] resolveMember hatasi:", error)
    return null
  }
  return created
}

// Var olan uyeyi getir — OLUSTURMAZ (alakasiz her DM icin kayit acilmasin diye)
async function findMember(supabase: any, userId: any, igsid: any) {
  const { data } = await supabase
    .from("loyalty_members")
    .select("*")
    .eq("user_id", userId)
    .eq("igsid", String(igsid))
    .single()
  return data || null
}

export async function isOptedOut(supabase: any, userId: any, igsid: any): Promise<boolean> {
  const m = await findMember(supabase, userId, igsid)
  return m?.opted_out === true
}

// POLITIKA: saatlik gonderim tavani (Faz 1 gunluk limitin saatlik esi)
export async function underHourlyLimit(supabase: any, userId: any): Promise<boolean> {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { count, error } = await supabase
    .from("webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .like("event_type", "send%")
    .gte("processed_at", hourAgo)
  if (error) {
    console.error("[v0] saatlik limit kontrol hatasi:", error)
    return true
  }
  return (count || 0) < HOURLY_DM_LIMIT
}

// Gunluk puan-eylem tavani — sabit UTC gununde sifirlanir (rolling window degil)
async function underDailyActionCap(supabase: any, memberId: string, cap: number): Promise<boolean> {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from("point_buckets")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .gte("earned_at", dayStart.toISOString())
  if (error) return true
  return (count || 0) < cap
}

// Takipci + min-follower sarti (sahte hesap filtresi). API dusarsa puanlamayi kilitleme.
export async function passesFollowerGate(user: any, igsid: any, settings: any): Promise<boolean> {
  try {
    const r = await fetch(
      `${GRAPH}/${igsid}?fields=is_user_follow_business,follower_count&access_token=${encodeURIComponent(user.access_token)}`,
    )
    const j = await r.json()
    if (j.error) return true
    if (j.is_user_follow_business === false) return false
    if (
      settings.min_follower_count > 0 &&
      typeof j.follower_count === "number" &&
      j.follower_count < settings.min_follower_count
    )
      return false
    return true
  } catch {
    return true
  }
}

// Puan kovasi ekle. event_key UNIQUE = ayni eylem iki kez puan VEREMEZ (anti-hile).
async function insertBucket(supabase: any, member: any, basePts: number, reason: string, eventKey: string, settings: any): Promise<number> {
  const pts = Math.round(basePts * Number(settings.launch_multiplier || 1))
  if (pts <= 0) return 0
  const expiresAt = settings.point_ttl_days
    ? new Date(Date.now() + settings.point_ttl_days * 86400_000).toISOString()
    : null
  const { error } = await supabase.from("point_buckets").insert({
    member_id: member.id,
    amount: pts,
    current_balance: pts,
    reason,
    event_key: eventKey,
    expires_at: expiresAt,
  })
  if (!error) return pts
  if (error.code === "23505") return 0 // bu eylem zaten puanlanmis
  console.error("[v0] insertBucket hatasi:", error)
  return 0
}

export async function getBalance(supabase: any, memberId: string): Promise<number> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from("point_buckets")
    .select("current_balance, expires_at")
    .eq("member_id", memberId)
    .eq("status", "available")
  if (error || !data) return 0
  return data
    .filter((b: any) => !b.expires_at || b.expires_at > nowIso)
    .reduce((s: number, b: any) => s + (b.current_balance || 0), 0)
}

async function listActiveRewards(supabase: any, userId: any) {
  const { data } = await supabase
    .from("rewards")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .order("cost", { ascending: true })
  return (data || []).filter((r: any) => r.stock === null || r.stock > 0)
}

// G2: uyenin referans kodu (yoksa uret — carpisma olursa yeniden dene)
async function ensureReferralCode(supabase: any, member: any): Promise<string | null> {
  if (member.referral_code) return member.referral_code
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // karisan karakterler (0/O, 1/I) yok
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "FM-"
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    const { error } = await supabase.from("loyalty_members").update({ referral_code: code }).eq("id", member.id)
    if (!error) return code
    if (error.code !== "23505") {
      console.error("[v0] referral kod uretme hatasi:", error)
      return null
    }
  }
  return null
}

// ============================================================
// YORUM -> PUAN (webhook PART A'dan cagrilir)
// Doner: kazanilan puan + ilk-puan bilgisi. Public cevaba iliştirilir.
// ============================================================
export async function awardCommentPoints(ctx: {
  supabase: any
  user: any
  senderId: any
  commentId: string
  username?: string | null
}): Promise<{ pts: number; programName: string; isFirst: boolean } | null> {
  const { supabase, user, senderId, commentId, username } = ctx
  try {
    const settings = await getGamificationSettings(supabase, user.id)
    if (!settings) return null
    const member = await resolveMember(supabase, user.id, senderId, username || null)
    if (!member || member.opted_out) return null
    // ilk puan mi? (karsilama mesaji icin, kova eklenmeden ONCE bakilir)
    const { count: priorCount } = await supabase
      .from("point_buckets")
      .select("id", { count: "exact", head: true })
      .eq("member_id", member.id)
    if (!(await underDailyActionCap(supabase, member.id, settings.daily_action_cap))) {
      console.log(`[v0] ⭐ Gunluk puan tavani dolu: ${senderId}`)
      return null
    }
    if (!(await passesFollowerGate(user, senderId, settings))) {
      console.log(`[v0] ⭐ Takip/min-follower sarti saglanmadi: ${senderId}`)
      return null
    }
    const pts = await insertBucket(supabase, member, settings.pts_comment, "comment", `pt_comment_${commentId}`, settings)
    if (pts > 0) {
      console.log(`[v0] ⭐ +${pts} puan: ${member.username || senderId} (yorum ${commentId})`)
      return { pts, programName: settings.program_name, isFirst: (priorCount || 0) === 0 }
    }
    return null
  } catch (e) {
    console.error("[v0] awardCommentPoints hatasi:", e)
    return null
  }
}

// ============================================================
// G2: STORY TEPKISI -> PUAN (webhook PART A.5'ten cagrilir)
// Meta 50k+ takipci sarti dogrulanana kadar settings.story_enabled=false
// ============================================================
export async function awardStoryPoints(ctx: {
  supabase: any
  user: any
  senderId: any
  eventKey: string
}): Promise<number> {
  const { supabase, user, senderId, eventKey } = ctx
  try {
    const settings = await getGamificationSettings(supabase, user.id)
    if (!settings || settings.story_enabled !== true) return 0
    const member = await resolveMember(supabase, user.id, senderId)
    if (!member || member.opted_out) return 0
    if (!(await underDailyActionCap(supabase, member.id, settings.daily_action_cap))) return 0
    if (!(await passesFollowerGate(user, senderId, settings))) return 0
    const pts = await insertBucket(supabase, member, settings.pts_story, "story", eventKey, settings)
    if (pts > 0) console.log(`[v0] ⭐ +${pts} story puani: ${senderId}`)
    return pts
  } catch (e) {
    console.error("[v0] awardStoryPoints hatasi:", e)
    return 0
  }
}

// ============================================================
// DM KOMUTLARI (webhook PART B'den cagrilir)
// G1: PUAN / ÖDÜLLER / DURDUR / BASLAT / NASIL + ODUL_<id> & SHOW_* payload
// G2: QUIZ / DAVET / KATIL / LIDERLIK / IPTAL + QUIZ_<id>_<idx> payload
//     + referral kod girisi (pending_state) + ilk etkilesim karsilamasi
// true donerse event tamamen islenmistir (otomasyon eslestirmeye gecme).
// ============================================================
export async function handleGamificationDM(ctx: {
  supabase: any
  user: any
  senderId: any
  kind: "text" | "payload"
  value: string
  evKey: string
  claimEvent: (supabase: any, key: string, type: string, userId: any) => Promise<boolean>
  underDailyLimit: (supabase: any, userId: any) => Promise<boolean>
}): Promise<boolean> {
  const { supabase, user, senderId, kind, value, evKey, claimEvent, underDailyLimit } = ctx

  const settings = await getGamificationSettings(supabase, user.id)
  if (!settings) return false

  // 1) Komutu coz
  let action: string | null = null
  let rewardId: string | null = null
  let quizId: string | null = null
  let quizChoice = -1
  if (kind === "payload") {
    if (value === "SHOW_REWARDS") action = "rewards"
    else if (value === "SHOW_HELP") action = "help"
    else if (value === "SHOW_LEADERBOARD") action = "leaderboard"
    else if (value === "SHOW_QUIZ") action = "quiz"
    else if (value.startsWith("ODUL_")) {
      action = "redeem"
      rewardId = value.slice(5)
    } else if (value.startsWith("QUIZ_")) {
      // QUIZ_<uuid>_<idx>
      const rest = value.slice(5)
      const sep = rest.lastIndexOf("_")
      if (sep > 0) {
        action = "quiz_answer"
        quizId = rest.slice(0, sep)
        quizChoice = Number(rest.slice(sep + 1))
      } else return false
    } else return false
  } else {
    const t = normalizeCommand(value)
    if (["puan", "puanim", "puanlarim", "bakiye", "bakiyem"].includes(t)) action = "balance"
    else if (["odul", "oduller", "odullerim", "hediye", "hediyeler", "katalog"].includes(t)) action = "rewards"
    else if (t === "durdur") action = "stop"
    else if (["baslat", "basla", "devam"].includes(t)) action = "start"
    else if (["nasil", "nasil kazanirim", "yardim", "puan nasil kazanirim"].includes(t)) action = "help"
    else if (["quiz", "soru", "bilgi yarismasi"].includes(t)) action = "quiz"
    else if (["davet", "davet et", "referans", "kodum"].includes(t)) action = "invite"
    else if (["katil", "kod", "kod gir", "davet kodu"].includes(t)) action = "join"
    else if (["liderlik", "siralama", "tablo", "lider"].includes(t)) action = "leaderboard"
    else if (["iptal", "vazgec"].includes(t)) action = "cancel"
    else {
      // Komut degil — bekleyen referral kod girisi var mi? (uye OLUSTURMADAN bak)
      const pendingMember = await findMember(supabase, user.id, senderId)
      if (pendingMember && !pendingMember.opted_out && pendingMember.pending_state === "ref_code") {
        action = "ref_code_entry"
      } else return false
    }
  }

  const member = await resolveMember(supabase, user.id, senderId)
  if (!member) return false

  // 2) Opt-out politikasi: DURDUR demis uyeye yalnizca BASLAT ile cevap verilir
  if (member.opted_out && action !== "start") {
    console.log(`[v0] ⏭️ Opt-out uye (${senderId}), oyunlastirma cevabi yok`)
    return true
  }

  // 3) Cevap mesajini kur
  let message: any = null
  const pn = settings.program_name || "Fabrika Puan"

  if (action === "balance") {
    const bal = await getBalance(supabase, member.id)
    message = {
      text: `⭐ ${bal} ${pn} puanın var!\n\nYorum yaparak puan kazanmaya devam edebilirsin. 🎶`,
      quick_replies: [
        { content_type: "text", title: "🎁 Ödüller", payload: "SHOW_REWARDS" },
        { content_type: "text", title: "🧠 Quiz", payload: "SHOW_QUIZ" },
        { content_type: "text", title: "🏆 Liderlik", payload: "SHOW_LEADERBOARD" },
        { content_type: "text", title: "❓ Nasıl Kazanırım", payload: "SHOW_HELP" },
      ],
    }
  } else if (action === "rewards") {
    const rewards = await listActiveRewards(supabase, user.id)
    if (rewards.length === 0) {
      message = { text: `Şu an aktif ödül yok — yakında eklenecek! Puan biriktirmeye devam et. ⭐` }
    } else {
      const bal = await getBalance(supabase, member.id)
      const lines = rewards.map((r: any, i: number) => `${i + 1}) ${r.title} — ${r.cost} puan`).join("\n")
      // quick reply basligi maks 20 karakter — tasani kes
      const quickReplies = rewards.slice(0, 12).map((r: any) => ({
        content_type: "text",
        title: `${r.cost}p ${r.title}`.slice(0, 20),
        payload: `ODUL_${r.id}`,
      }))
      message = {
        text: `🎁 ${pn} Ödül Kataloğu:\n\n${lines}\n\n⭐ Puanın: ${bal}\nAlmak istediğin ödüle dokun!`,
        quick_replies: quickReplies,
      }
    }
  } else if (action === "redeem") {
    const { data: reward } = await supabase
      .from("rewards")
      .select("*")
      .eq("id", rewardId)
      .eq("user_id", user.id)
      .eq("active", true)
      .single()
    if (!reward) {
      message = { text: `Bu ödül artık mevcut değil. Güncel liste için "ÖDÜLLER" yaz. 🎁` }
    } else if (reward.min_follow && !(await passesFollowerGate(user, senderId, settings))) {
      message = { text: `Bu ödül takipçilere özel! Önce @${user.username} hesabını takip et, sonra tekrar dene. 🔒` }
    } else {
      const result = await supabase.rpc("redeem_reward", { p_member_id: member.id, p_reward_id: reward.id })
      const r = result.data
      if (result.error || !r) {
        console.error("[v0] redeem RPC hatasi:", result.error)
        message = { text: `Bir sorun oluştu, biraz sonra tekrar dener misin? 🙏` }
      } else if (r.ok) {
        message = {
          text:
            `🎉 Tebrikler! "${r.title}" ödülünü aldın!` +
            (r.code ? `\n\n🎟️ Kodun: ${r.code}` : "") +
            `\n\n⭐ Kalan puanın: ${r.balance}`,
        }
      } else if (r.error === "insufficient") {
        message = {
          text: `Yetersiz puan 😕 Bu ödül ${r.cost} puan, sende ${r.balance} puan var.\n\nYorum yaparak puan kazanabilirsin! ⭐`,
        }
      } else if (r.error === "out_of_stock") {
        message = { text: `Bu ödülün stoğu tükendi 😔 Diğer ödüller için "ÖDÜLLER" yaz.` }
      } else {
        message = { text: `Bu ödül şu an alınamıyor. Güncel liste için "ÖDÜLLER" yaz.` }
      }
    }
  } else if (action === "quiz") {
    if (settings.quiz_enabled !== true) {
      message = { text: `Quiz şu an kapalı. Puanını görmek için "PUAN" yazabilirsin. ⭐` }
    } else {
      const { data: quizzes } = await supabase
        .from("quizzes")
        .select("*")
        .eq("user_id", user.id)
        .eq("active", true)
        .order("created_at", { ascending: true })
      const { data: answered } = await supabase.from("quiz_answers").select("quiz_id").eq("member_id", member.id)
      const answeredIds = new Set((answered || []).map((a: any) => a.quiz_id))
      const quiz = (quizzes || []).find((q: any) => !answeredIds.has(q.id))
      if (!quiz) {
        message = { text: `Şu an cevaplayabileceğin yeni quiz yok — yenileri yakında! 🧠\n\nPuanın için "PUAN" yaz.` }
      } else {
        message = {
          text: `🧠 QUIZ (+${settings.pts_quiz_correct} / -${settings.pts_quiz_wrong} puan):\n\n${quiz.question}`,
          quick_replies: quiz.options.slice(0, 13).map((opt: string, i: number) => ({
            content_type: "text",
            title: String(opt).slice(0, 20),
            payload: `QUIZ_${quiz.id}_${i}`,
          })),
        }
      }
    }
  } else if (action === "quiz_answer") {
    const { data: quiz } = await supabase
      .from("quizzes")
      .select("*")
      .eq("id", quizId)
      .eq("user_id", user.id)
      .single()
    if (!quiz || !Number.isInteger(quizChoice) || quizChoice < 0 || quizChoice >= quiz.options.length) {
      message = { text: `Bu quiz artık geçerli değil. Yeni quiz için "QUIZ" yaz. 🧠` }
    } else {
      const correct = quizChoice === quiz.correct_index
      const { error: ansErr } = await supabase
        .from("quiz_answers")
        .insert({ quiz_id: quiz.id, member_id: member.id, selected_index: quizChoice, correct })
      if (ansErr?.code === "23505") {
        message = { text: `Bu quizi zaten cevapladın! 🙂 Yeni quiz için "QUIZ" yaz.` }
      } else if (ansErr) {
        console.error("[v0] quiz cevap kayit hatasi:", ansErr)
        message = { text: `Bir sorun oluştu, biraz sonra tekrar dener misin? 🙏` }
      } else if (correct) {
        const pts = await insertBucket(supabase, member, settings.pts_quiz_correct, "quiz", `pt_quiz_${quiz.id}_${member.id}`, settings)
        await supabase.from("loyalty_members").update({ quiz_score: (member.quiz_score || 0) + 1 }).eq("id", member.id)
        const bal = await getBalance(supabase, member.id)
        message = { text: `🎉 DOĞRU! +${pts} puan kazandın!\n\n⭐ Yeni bakiyen: ${bal}\nYeni quiz için "QUIZ" yaz.` }
      } else {
        const { data: deducted } = await supabase.rpc("deduct_points", {
          p_member_id: member.id,
          p_amount: settings.pts_quiz_wrong,
        })
        await supabase.from("loyalty_members").update({ quiz_score: (member.quiz_score || 0) - 1 }).eq("id", member.id)
        const bal = await getBalance(supabase, member.id)
        message = {
          text: `❌ Yanlış! Doğru cevap: ${quiz.options[quiz.correct_index]}\n\n-${deducted ?? settings.pts_quiz_wrong} puan. ⭐ Bakiyen: ${bal}\nTelafi için yorum yapmaya devam! 🎶`,
        }
      }
    }
  } else if (action === "invite") {
    if (settings.referral_enabled !== true) {
      message = { text: `Davet programı şu an kapalı. Puanın için "PUAN" yaz. ⭐` }
    } else {
      const code = await ensureReferralCode(supabase, member)
      if (!code) {
        message = { text: `Bir sorun oluştu, biraz sonra tekrar dener misin? 🙏` }
      } else {
        message = {
          text:
            `🤝 Davet kodun: ${code}\n\n` +
            `Arkadaşın @${user.username} hesabına DM'den "KATIL" yazsın, sonra bu kodu girsin.\n\n` +
            `🎁 O +${settings.pts_ref_invitee} puan, sen +${settings.pts_ref_inviter} puan kazanırsın!`,
        }
      }
    }
  } else if (action === "join") {
    if (settings.referral_enabled !== true) {
      message = { text: `Davet programı şu an kapalı. Puanın için "PUAN" yaz. ⭐` }
    } else if (member.referred_by) {
      message = { text: `Zaten bir davet koduyla katıldın! 🙂 Puanın için "PUAN" yaz.` }
    } else {
      await supabase.from("loyalty_members").update({ pending_state: "ref_code" }).eq("id", member.id)
      message = { text: `Davet kodunu yaz (örn. FM-AB12CD). ✍️\n\nVazgeçmek için "IPTAL" yazabilirsin.` }
    }
  } else if (action === "ref_code_entry") {
    const code = value.trim().toUpperCase().replace(/\s+/g, "")
    const { data: inviter } = await supabase
      .from("loyalty_members")
      .select("*")
      .eq("user_id", user.id)
      .eq("referral_code", code)
      .single()
    if (!inviter) {
      message = { text: `Bu kodu bulamadım 😕 Kontrol edip tekrar yazar mısın? Vazgeçmek için "IPTAL".` }
    } else if (inviter.id === member.id) {
      // ANTI-HILE: self-referral engeli
      await supabase.from("loyalty_members").update({ pending_state: null }).eq("id", member.id)
      message = { text: `Kendi kodunu kullanamazsın 🙂 Arkadaşlarını davet etmek için "DAVET" yaz.` }
    } else if (member.referred_by) {
      await supabase.from("loyalty_members").update({ pending_state: null }).eq("id", member.id)
      message = { text: `Zaten bir davet koduyla katıldın! Puanın için "PUAN" yaz. ⭐` }
    } else {
      await supabase
        .from("loyalty_members")
        .update({ pending_state: null, referred_by: inviter.id })
        .eq("id", member.id)
      // ANTI-HILE: event_key davet edilene bagli — ayni uye ikinci kez aktivasyon tetikleyemez
      const ptsIn = await insertBucket(supabase, member, settings.pts_ref_invitee, "referral", `pt_ref_in_${member.id}`, settings)
      const ptsOut = await insertBucket(supabase, inviter, settings.pts_ref_inviter, "referral", `pt_ref_out_${member.id}`, settings)
      message = { text: `🎉 Kod geçerli! +${ptsIn} puan kazandın!\n\nBakiyen için "PUAN" yaz. ⭐` }
      // Davet edeni bilgilendirmeyi DENE — 24s penceresi kapaliysa gitmez, puan yine de islenmistir
      if (ptsOut > 0 && !inviter.opted_out) {
        try {
          await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(user.access_token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: inviter.igsid },
              message: { text: `🤝 Davet ettiğin kişi katıldı: +${ptsOut} puan kazandın! "PUAN" yazarak bakiyeni görebilirsin. ⭐` },
            }),
          })
        } catch {}
      }
    }
  } else if (action === "leaderboard") {
    message = {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [
            {
              title: "🏆 Liderlik Tablosu",
              subtitle: `Bu ayın en aktif ${pn} üyeleri`,
              buttons: [{ type: "web_url", url: `${APP_URL}/liderlik?h=${encodeURIComponent(user.username)}`, title: "Tabloyu Gör" }],
            },
          ],
        },
      },
    }
  } else if (action === "cancel") {
    await supabase.from("loyalty_members").update({ pending_state: null }).eq("id", member.id)
    message = { text: `Tamam, iptal edildi. 👍 Puanın için "PUAN" yazabilirsin.` }
  } else if (action === "stop") {
    await supabase.from("loyalty_members").update({ opted_out: true, pending_state: null }).eq("id", member.id)
    message = {
      text: `Otomatik mesajlar durduruldu. ✅\n\nTekrar başlatmak istersen "BASLAT" yazman yeterli.`,
    }
  } else if (action === "start") {
    await supabase.from("loyalty_members").update({ opted_out: false }).eq("id", member.id)
    message = {
      text: `Tekrar hoş geldin! 🎶 Otomatik mesajlar açıldı.\n\nPuanını görmek için "PUAN" yazabilirsin. ⭐`,
    }
  } else if (action === "help") {
    message = {
      text:
        `⭐ ${pn} nasıl çalışır?\n\n` +
        `• Gönderilerimize yorum yap → +${settings.pts_comment} puan\n` +
        `• "QUIZ" → doğru cevap +${settings.pts_quiz_correct}, yanlış -${settings.pts_quiz_wrong}\n` +
        `• "DAVET" → arkadaşını getir, +${settings.pts_ref_inviter} puan\n` +
        `• Günde en fazla ${settings.daily_action_cap} eylem puan kazandırır\n` +
        `• "PUAN" bakiye · "ÖDÜLLER" katalog · "LIDERLIK" sıralama\n` +
        `• "DURDUR" → mesajları kapat`,
    }
  }

  if (!message) return false

  // G2: ilk etkilesimde karsilama (yalnizca duz metin cevaplara eklenir)
  if (!member.welcomed && message.text && !["stop", "start"].includes(action)) {
    message.text = `🎶 ${pn} programına hoş geldin! Etkileşimlerin puan kazandırır, puanlar ödüle dönüşür.\n\n${message.text}`
    await supabase.from("loyalty_members").update({ welcomed: true }).eq("id", member.id)
  }

  // 4) POLITIKA: gunluk + saatlik gonderim limitleri, insani gecikme, send kaydi
  if (!(await underDailyLimit(supabase, user.id))) {
    console.log(`[v0] 🛑 Gunluk DM limiti doldu (${user.username}), oyunlastirma cevabi atlandi`)
    return true
  }
  if (!(await underHourlyLimit(supabase, user.id))) {
    console.log(`[v0] 🛑 Saatlik DM limiti doldu (${user.username}), oyunlastirma cevabi atlandi`)
    return true
  }
  await claimEvent(supabase, `send_gami_${evKey}`, "send_dm", user.id)
  await sleep(1200 + Math.random() * 2300)

  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(user.access_token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: senderId }, message }),
    })
    const json = await res.json()
    if (json.error) console.error("[v0] 🔴 Oyunlastirma DM hatasi:", JSON.stringify(json.error))
    else console.log(`[v0] 🟢 Oyunlastirma cevabi gitti: ${action} → ${senderId}`)
  } catch (e) {
    console.error("[v0] 🔴 Oyunlastirma DM network hatasi:", e)
  }
  return true
}
