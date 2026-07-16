import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { requireOwner } from "@/lib/app-auth"

export async function GET(request: NextRequest) {
    try {
        const conversationId = request.nextUrl.searchParams.get("conversationId")
        if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 })

        const supabase = await getSupabaseServerClient()

        // SAHIPLIK: konusmanin bagli oldugu Instagram hesabi bu oturumun mu?
        // (users.id BIGINT — JS yuvarlanmasin diye ::text ile cekilir)
        const { data: conv } = await supabase
            .from("conversations")
            .select("user_id_s:user_id::text")
            .eq("id", conversationId)
            .single()
        if (!conv) return NextResponse.json({ error: "Konusma bulunamadi" }, { status: 404 })
        const own = await requireOwner(supabase, request, conv.user_id_s)
        if (!own.ok) return NextResponse.json({ error: own.error }, { status: own.status })

        // Fetch messages for this conversation
        const { data: messages, error } = await supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })

        if (error) throw error

        return NextResponse.json(messages)
    } catch (error) {
        console.error("[Inbox] Messages GET error:", error)
        return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
    }
}
