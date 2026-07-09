/* @ts-nocheck */

// Mesaj Özelleştirme: public yorum cevabi varyasyonlari (maks 5)
// + takip kapisi karti metin/butonlari (GET/PUT)

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

const DEFAULTS = {
  public_replies: ["DM'ne bak! 📩", "Gönderdim, DM'ni kontrol et! 🔥", "DM kutuna düştü! ✨"],
  gate_title: "Takipcilere ozel icerik 🔒",
  gate_subtitle: "Once @{username} hesabini takip et, sonra butona bas!",
  gate_btn_profile: "Profile Git",
  gate_btn_follow: "TAKIP ETTIM 🙌",
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const { data } = await supabase.from("dm_customization").select("*").eq("user_id", userId).single()
    return NextResponse.json(data || { user_id: userId, ...DEFAULTS })
  } catch (error) {
    console.error("Customization GET Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, public_replies, gate_title, gate_subtitle, gate_btn_profile, gate_btn_follow } = body
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

    const replies = (Array.isArray(public_replies) ? public_replies : [])
      .map((r: any) => String(r).trim())
      .filter(Boolean)
      .slice(0, 5)
    if (replies.length === 0) {
      return NextResponse.json({ error: "En az 1 public cevap gerekli" }, { status: 400 })
    }
    const btnProfile = String(gate_btn_profile || DEFAULTS.gate_btn_profile).trim().slice(0, 20)
    const btnFollow = String(gate_btn_follow || DEFAULTS.gate_btn_follow).trim().slice(0, 20)
    if (!btnProfile || !btnFollow) {
      return NextResponse.json({ error: "Buton etiketleri boş olamaz" }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("dm_customization")
      .upsert(
        {
          user_id: userId,
          public_replies: replies,
          gate_title: String(gate_title || DEFAULTS.gate_title).trim().slice(0, 80),
          gate_subtitle: String(gate_subtitle || DEFAULTS.gate_subtitle).trim().slice(0, 80),
          gate_btn_profile: btnProfile,
          gate_btn_follow: btnFollow,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("Customization PUT Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
