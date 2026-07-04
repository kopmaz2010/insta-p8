/* @ts-nocheck */

// Oyunlastirma Paneli: ayarlar + AI yonetici (GET/PUT)

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// panelden duzenlenebilir alanlar (whitelist — baska kolon yazilamaz)
const SETTINGS_FIELDS = [
  "program_name",
  "active",
  "pts_comment",
  "pts_story",
  "pts_reaction",
  "pts_quiz_correct",
  "pts_quiz_wrong",
  "pts_ref_inviter",
  "pts_ref_invitee",
  "daily_action_cap",
  "daily_quiz_limit",
  "daily_points_cap",
  "min_follower_count",
  "launch_multiplier",
  "quiz_enabled",
  "referral_enabled",
  "story_enabled",
]
const AI_FIELDS = ["enabled", "persona"]

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    const supabase = await getSupabaseServerClient()

    const { data: settings } = await supabase.from("gamification_settings").select("*").eq("user_id", userId).single()
    const { data: ai } = await supabase.from("ai_settings").select("*").eq("user_id", userId).single()

    return NextResponse.json({
      settings: settings || null,
      ai: ai ? { enabled: ai.enabled, persona: ai.persona } : null,
      aiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    })
  } catch (error) {
    console.error("Gamification Settings GET Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, settings, ai } = body
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    const supabase = await getSupabaseServerClient()

    if (settings) {
      const clean: any = {}
      for (const f of SETTINGS_FIELDS) if (f in settings) clean[f] = settings[f]
      const { error } = await supabase
        .from("gamification_settings")
        .upsert({ user_id: userId, ...clean }, { onConflict: "user_id" })
      if (error) throw error
    }
    if (ai) {
      const clean: any = {}
      for (const f of AI_FIELDS) if (f in ai) clean[f] = ai[f]
      const { error } = await supabase
        .from("ai_settings")
        .upsert({ user_id: userId, ...clean, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      if (error) throw error
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Gamification Settings PUT Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
