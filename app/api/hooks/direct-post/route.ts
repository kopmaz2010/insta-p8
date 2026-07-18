import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { createReelsContainer, getContainerStatus, publishContainer, recordTrialPost, underTrialQuota } from "@/lib/instagram-publishing"
import { checkApiSecret } from "@/lib/app-auth"

// Vercel: Allow up to 60s execution
export const maxDuration = 60

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

/**
 * Direct Post — Publishes a reel to Instagram immediately.
 * POST /api/hooks/direct-post
 * Headers: { x-api-secret: YOUR_SECRET }
 * Body: { videoUrl, caption, userId }
 * 
 * Flow: videoUrl → Instagram Container → Wait for processing → Publish
 * Also logs to reels_posts table for tracking.
 */
export async function POST(request: NextRequest) {
    try {
        // 1. Auth (sabit-zamanli)
        if (!checkApiSecret(request.headers.get("x-api-secret"))) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        // 2. Parse Body (trial: true -> deneme reelsi; trialStrategy: MANUAL | SS_PERFORMANCE;
        //    force: true -> tekrar-paylasim korumasini bilerek atla)
        const { videoUrl, caption, userId, trial, trialStrategy, force, aiGenerated } = await request.json()
        if (!videoUrl || !userId) {
            return NextResponse.json({ error: "Missing videoUrl or userId" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // 3. Get User's Instagram Access Token
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("access_token")
            .eq("id", userId)
            .single()

        if (userError || !user?.access_token) {
            return NextResponse.json({ error: "User not found or no access token" }, { status: 404 })
        }

        // 3.4 MADDE 5 (10-ACIK): TEKRAR-PAYLASIM KORUMASI — ayni video bu hesapta
        // zaten yayinlandiysa engelle (bilerek tekrar icin force:true gonderilir)
        if (!force) {
            const { data: dupe } = await supabase
                .from("reels_posts")
                .select("id, status, published_at")
                .eq("user_id", userId)
                .eq("video_url", videoUrl)
                .in("status", ["PUBLISHED", "success"])
                .limit(1)
            if (dupe?.length) {
                return NextResponse.json({
                    error: "Bu video bu hesapta zaten paylaşılmış (tekrar-paylaşım koruması). Bilerek tekrar paylaşmak için force:true gönderin.",
                    duplicate: true,
                    previousPublishedAt: dupe[0].published_at,
                }, { status: 409 })
            }
            // ISLEMDE olan ayni video da engellenir (retry/timeout senaryosu):
            // container olusturuldu ama henuz publish edilmedi — ikinci container acma
            const { data: inflight } = await supabase
                .from("reels_posts")
                .select("id, ig_container_id")
                .eq("user_id", userId)
                .eq("video_url", videoUrl)
                .eq("status", "PENDING")
                .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString())
                .limit(1)
            if (inflight?.length) {
                return NextResponse.json({
                    error: "Bu video için zaten işlemde bir container var (çift paylaşım koruması).",
                    duplicate: true,
                    containerId: inflight[0].ig_container_id,
                    userId,
                }, { status: 409 })
            }
        }

        // 3.5 KOTA: hesap basina gunde max 15 deneme reelsi — asilirsa acik hata don,
        // cagiran (n8n vb.) trial:false ile normal paylasima karar verebilsin
        const effectiveTrial = trial ? (trialStrategy === "MANUAL" ? "MANUAL" : "SS_PERFORMANCE") : null
        if (effectiveTrial && !(await underTrialQuota(supabase, userId))) {
            return NextResponse.json({
                error: "Günlük deneme reelsi kotası doldu (varsayılan 15/gün, DAILY_TRIAL_LIMIT env ile değişir). Normal paylaşım için trial:false gönderin.",
                quotaExceeded: true,
            }, { status: 429 })
        }

        // 4. Create Instagram Reels Container
        console.log(`[DirectPost] Creating container for user ${userId}${effectiveTrial ? " (deneme reelsi)" : ""}`)
        // AI etiketi: body'de acikca gelmediyse hesabin scheduler ayarindan oku
        let markAi = aiGenerated === true
        if (aiGenerated === undefined) {
            const { data: cfg } = await supabase.from("scheduler_config").select("mark_as_ai").eq("user_id", userId).single()
            markAi = cfg?.mark_as_ai === true
        }

        const containerId = await createReelsContainer(
            user.access_token,
            videoUrl,
            caption || "",
            undefined,
            effectiveTrial,
            markAi,
        )
        if (effectiveTrial) await recordTrialPost(supabase, userId, containerId)

        // 4.5 PENDING kaydi: dupe korumasi publish'ten ONCE de gorsun; publish-reel
        // bu kaydi claim edip gunceller (insert degil) — video_url asla kaybolmaz
        await supabase.from("reels_posts").insert({
            user_id: userId,
            video_url: videoUrl,
            caption: caption || "",
            ig_container_id: containerId,
            status: "PENDING",
        })

        // 5. Return immediately (Client handles polling)
        // This avoids Vercel 10s/60s function timeouts
        return NextResponse.json({
            success: true,
            status: "IN_PROGRESS",
            message: "Container created. Poll status endpoint to publish.",
            containerId,
            userId // Return userId for auth in next step
        }, { status: 202 })

    } catch (error: any) {
        console.error("[DirectPost] Error:", error)
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 })
    }
}
