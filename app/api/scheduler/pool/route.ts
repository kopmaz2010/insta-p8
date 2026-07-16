import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireOwner } from "@/lib/app-auth"

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const userId = searchParams.get("userId")
        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

        const supabase = await getSupabaseServerClient()
        const own = await requireOwner(supabase, request, userId)
        if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

        // Fetch items ordered by sequence
        const { data, error } = await supabase
            .from("content_pool")
            .select("*")
            .eq("user_id", userId)
            .eq("is_active", true)
            .order("sequence_index", { ascending: true })

        if (error) throw error

        return NextResponse.json(data)
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { userId, video_url, caption, cover_url } = body

        if (!userId || !video_url) return NextResponse.json({ error: "Missing fields" }, { status: 400 })

        const supabase = await getSupabaseServerClient()
        const own = await requireOwner(supabase, request, userId)
        if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

        // Get current max sequence
        const { data: maxContent } = await supabase
            .from("content_pool")
            .select("sequence_index")
            .eq("user_id", userId)
            .order("sequence_index", { ascending: false })
            .limit(1)
            .single()

        const nextSeq = (maxContent?.sequence_index || 0) + 1

        const { data, error } = await supabase
            .from("content_pool")
            .insert({
                user_id: userId,
                video_url,
                caption,
                sequence_index: nextSeq,
                cover_url: cover_url || null
            })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (err: any) {
        console.error("Pool Error:", err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const id = searchParams.get("id")
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

        const supabase = await getSupabaseServerClient()

        // SAHIPLIK: silinecek havuz ogesi bu oturumun hesabina mi ait?
        // (users.id BIGINT — JS yuvarlanmasin diye ::text ile cekilir)
        const { data: row } = await supabase
            .from("content_pool")
            .select("user_id_s:user_id::text")
            .eq("id", id)
            .single()
        if (!row) return NextResponse.json({ error: "Kayit bulunamadi" }, { status: 404 })
        const own = await requireOwner(supabase, request, row.user_id_s)
        if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

        const { error } = await supabase
            .from("content_pool")
            .delete()
            .eq("id", id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
