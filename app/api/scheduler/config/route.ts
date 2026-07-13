import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const userId = searchParams.get("userId")
        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

        const supabase = await getSupabaseServerClient()

        const { data, error } = await supabase
            .from("scheduler_config")
            .select("*")
            .eq("user_id", userId)
            .single()

        // Returns null data if not found, which is fine
        return NextResponse.json(data)
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { userId, is_running, interval_minutes, start_time, end_time, post_as_trial, trial_strategy, mark_as_ai } = body

        if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 })

        const supabase = await getSupabaseServerClient()

        // KISMI GUNCELLEME: yalnizca gonderilen alanlar yazilir. Onceden eksik
        // alanlar false'a zorlaniyordu — tek alan degistiren bir cagri
        // mark_as_ai/post_as_trial bayraklarini sessizce sifirliyordu.
        const updates: any = { updated_at: new Date().toISOString() }
        if ("is_running" in body) updates.is_running = is_running
        if ("interval_minutes" in body) updates.interval_minutes = interval_minutes
        if ("start_time" in body) updates.start_time = start_time
        if ("end_time" in body) updates.end_time = end_time
        if ("post_as_trial" in body) updates.post_as_trial = post_as_trial === true
        if ("trial_strategy" in body) updates.trial_strategy = trial_strategy === "MANUAL" ? "MANUAL" : "SS_PERFORMANCE"
        if ("mark_as_ai" in body) updates.mark_as_ai = mark_as_ai === true

        const { data, error } = await supabase
            .from("scheduler_config")
            .upsert({ user_id: userId, ...updates }) // upsert on PK
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
