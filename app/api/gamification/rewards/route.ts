/* @ts-nocheck */

// Oyunlastirma Paneli: odul CRUD

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireOwner } from "@/lib/app-auth"

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const own = await requireOwner(supabase, request, userId)
    if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })
    const { data, error } = await supabase
      .from("rewards")
      .select("*")
      .eq("user_id", userId)
      .order("cost", { ascending: true })
    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Rewards GET Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, title, cost, stock, fixed_code, min_follow, active } = body
    if (!userId || !title?.trim() || !(Number(cost) > 0)) {
      return NextResponse.json({ error: "Başlık ve pozitif puan bedeli gerekli" }, { status: 400 })
    }
    const supabase = await getSupabaseServerClient()
    const own = await requireOwner(supabase, request, userId)
    if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })
    const { data, error } = await supabase
      .from("rewards")
      .insert({
        user_id: userId,
        title: title.trim(),
        cost: Number(cost),
        stock: stock === null || stock === "" || stock === undefined ? null : Number(stock),
        fixed_code: fixed_code?.trim() || null,
        min_follow: min_follow !== false,
        active: active !== false,
      })
      .select("*")
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("Rewards POST Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, id, title, cost, stock, fixed_code, min_follow, active } = body
    if (!userId || !id || !title?.trim() || !(Number(cost) > 0)) {
      return NextResponse.json({ error: "Eksik/geçersiz alanlar" }, { status: 400 })
    }
    const supabase = await getSupabaseServerClient()
    const own = await requireOwner(supabase, request, userId)
    if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })
    const { data, error } = await supabase
      .from("rewards")
      .update({
        title: title.trim(),
        cost: Number(cost),
        stock: stock === null || stock === "" || stock === undefined ? null : Number(stock),
        fixed_code: fixed_code?.trim() || null,
        min_follow: min_follow !== false,
        active: active !== false,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("Rewards PUT Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    const id = request.nextUrl.searchParams.get("id")
    if (!userId || !id) return NextResponse.json({ error: "Missing userId/id" }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const own = await requireOwner(supabase, request, userId)
    if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })
    // redemptions FK'si nedeniyle silinemiyorsa pasife cek
    const { error } = await supabase.from("rewards").delete().eq("id", id).eq("user_id", userId)
    if (error) {
      await supabase.from("rewards").update({ active: false }).eq("id", id).eq("user_id", userId)
      return NextResponse.json({ success: true, deactivated: true })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Rewards DELETE Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
