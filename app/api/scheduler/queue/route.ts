/* @ts-nocheck */

// ============================================================
// ZAMANLANMIS PAYLASIM KUYRUGU (scheduled_posts)
// Publisher sayfasindaki "Content Pool" rotasyon havuzudur (content_pool
// tablosu) — tekil zamanlanmis paylasimlar AYRI tabloda tutulur ve panelde
// HIC gorunmuyordu ("15 reels planladim ama sistemde yok" sikayeti).
// GET: bu hesabin kuyrugu (yaklasan + son yayinlananlar)
// DELETE ?id=: yalnizca HENUZ YAYINLANMAMIS kaydi iptal eder.
//   Yayinlanmis (published) kayit SILINMEZ — IG'deki gonderiye dokunmaz ama
//   tekrar-paylasim korumasinin gecmisi olarak durmalidir.
// ============================================================

import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireOwner } from "@/lib/app-auth"

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId gerekli" }, { status: 400 })

  const supabase = await getSupabaseServerClient()
  const own = await requireOwner(supabase, request, userId)
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("id, status, scheduled_at, published_at, caption, video_url, as_trial, as_ai, error_message, ig_media_id::text")
    .eq("user_id", userId)
    .order("scheduled_at", { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ error: "Kuyruk okunamadı" }, { status: 500 })

  const posts = (data || []).map((p: any) => ({
    id: p.id,
    status: p.status,
    scheduledAt: p.scheduled_at,
    publishedAt: p.published_at,
    caption: p.caption || "",
    fileName: String(p.video_url || "").split("/").pop(),
    asTrial: p.as_trial === true,
    asAi: p.as_ai === true,
    error: p.error_message,
    mediaId: p.ig_media_id,
  }))

  return NextResponse.json({
    posts,
    ozet: {
      bekleyen: posts.filter((p: any) => ["pending", "processing", "publishing"].includes(p.status)).length,
      yayinlanan: posts.filter((p: any) => p.status === "published").length,
      hatali: posts.filter((p: any) => p.status === "error").length,
    },
  })
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 })

  const supabase = await getSupabaseServerClient()
  // sahiplik: kaydin user_id'si uzerinden (BIGINT yuvarlanmasina karsi ::text)
  const { data: row } = await supabase
    .from("scheduled_posts")
    .select("id, status, user_id_s:user_id::text")
    .eq("id", id)
    .single()
  if (!row) return NextResponse.json({ error: "kayıt bulunamadı" }, { status: 404 })

  const own = await requireOwner(supabase, request, row.user_id_s)
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

  if (row.status === "published") {
    return NextResponse.json({ error: "Yayınlanmış paylaşım listeden silinemez" }, { status: 409 })
  }

  await supabase.from("scheduled_posts").delete().eq("id", id).neq("status", "published")
  return NextResponse.json({ ok: true })
}
