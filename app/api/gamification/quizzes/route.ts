/* @ts-nocheck */

// Oyunlastirma Paneli: quiz CRUD — kullanici soru/sik/dogru-cevap/aktiflik yonetir

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

function validateQuiz(q: any) {
  if (!q.question || typeof q.question !== "string" || !q.question.trim()) return "Soru metni boş olamaz"
  if (!Array.isArray(q.options) || q.options.length < 2) return "En az 2 şık gerekli"
  if (q.options.length > 13) return "En fazla 13 şık olabilir (Instagram quick reply sınırı)"
  if (q.options.some((o: any) => !o || !String(o).trim())) return "Boş şık olamaz"
  const ci = Number(q.correct_index)
  if (!Number.isInteger(ci) || ci < 0 || ci >= q.options.length) return "Doğru cevap işaretlenmeli"
  return null
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("quizzes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Quizzes GET Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, question, options, correct_index, active } = body
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })
    const invalid = validateQuiz(body)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("quizzes")
      .insert({
        user_id: userId,
        question: question.trim(),
        options: options.map((o: any) => String(o).trim()),
        correct_index: Number(correct_index),
        active: active !== false,
      })
      .select("*")
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("Quizzes POST Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, id, question, options, correct_index, active } = body
    if (!userId || !id) return NextResponse.json({ error: "Missing userId/id" }, { status: 400 })
    const invalid = validateQuiz(body)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const { data, error } = await supabase
      .from("quizzes")
      .update({
        question: question.trim(),
        options: options.map((o: any) => String(o).trim()),
        correct_index: Number(correct_index),
        active: active !== false,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error("Quizzes PUT Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId")
    const id = request.nextUrl.searchParams.get("id")
    if (!userId || !id) return NextResponse.json({ error: "Missing userId/id" }, { status: 400 })
    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("quizzes").delete().eq("id", id).eq("user_id", userId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Quizzes DELETE Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
