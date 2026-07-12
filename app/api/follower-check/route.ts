/* @ts-nocheck */

// ============================================================
// TAKIP DURUMU KONTROLU
// KISIT: Instagram API tum takipci listesini VERMEZ (Meta gizlilik).
// Yapilabilecek: ETKILESIME girmis kisiler (DM atan / puan kazanan uye)
// icin is_user_follow_business ile "takip ediyor mu" kontrolu.
// Canli Graph cagrisi — cache yok (loyalty_members.follows kolonu ileride
// eklenirse cache'lenebilir).
// ============================================================

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

const GRAPH = "https://graph.instagram.com/v24.0"

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    const supabase = await getSupabaseServerClient()

    const { data: user } = await supabase.from("users").select("access_token, username").eq("id", userId).single()
    if (!user?.access_token) return NextResponse.json({ error: "Hesap/token yok" }, { status: 404 })

    // Etkilesimdeki benzersiz kisiler: DM konusmalari (en genis kaynak) + puan uyeleri
    const { data: convs } = await supabase
      .from("conversations")
      .select("recipient_id, recipient_username, last_message_at")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false })
      .limit(150)
    const { data: members } = await supabase
      .from("loyalty_members")
      .select("igsid, username")
      .eq("user_id", userId)
      .limit(150)

    const map = new Map<string, string>() // igsid -> username
    for (const c of convs || []) if (c.recipient_id) map.set(String(c.recipient_id), c.recipient_username || "")
    for (const m of members || []) if (m.igsid && !map.has(String(m.igsid))) map.set(String(m.igsid), m.username || "")

    const people = Array.from(map.entries()).slice(0, 80) // Vercel 60sn butcesi
    if (people.length === 0) {
      return NextResponse.json({ account: user.username, total: 0, followers: 0, nonFollowers: 0, people: [], note: "Henuz etkilesim yok" })
    }

    // Paralel batch (8'erli) — Graph rate'i zorlamadan hizli
    const results: any[] = []
    for (let i = 0; i < people.length; i += 8) {
      const chunk = people.slice(i, i + 8)
      const settled = await Promise.all(
        chunk.map(async ([igsid, username]) => {
          try {
            const r = await fetch(
              `${GRAPH}/${igsid}?fields=is_user_follow_business,username&access_token=${encodeURIComponent(user.access_token)}`,
            )
            const j = await r.json()
            return {
              igsid,
              username: j.username || username || `id_${String(igsid).slice(0, 6)}`,
              follows: j.error ? null : j.is_user_follow_business === true,
            }
          } catch {
            return { igsid, username: username || `id_${String(igsid).slice(0, 6)}`, follows: null }
          }
        }),
      )
      results.push(...settled)
    }

    const followers = results.filter((r) => r.follows === true).length
    const nonFollowers = results.filter((r) => r.follows === false).length
    const unknown = results.filter((r) => r.follows === null).length
    // takip etmeyenler once (aksiyon alinabilir), sonra bilinmeyen, sonra takipci
    results.sort((a, b) => {
      const rank = (v: any) => (v.follows === false ? 0 : v.follows === null ? 1 : 2)
      return rank(a) - rank(b)
    })

    return NextResponse.json({
      account: user.username,
      total: results.length,
      followers,
      nonFollowers,
      unknown,
      people: results,
    })
  } catch (error) {
    console.error("Follower Check Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
