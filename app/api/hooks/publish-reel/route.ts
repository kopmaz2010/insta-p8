import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { getContainerStatus, publishContainer } from "@/lib/instagram-publishing"

export const maxDuration = 60

/**
 * Publishes a reel container once it's ready.
 * POST /api/hooks/publish-reel
 * Body: { containerId, userId }
 */
export async function POST(request: NextRequest) {
    try {
        const apiSecret = request.headers.get("x-api-secret")
        if (apiSecret !== process.env.API_SECRET_KEY) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { containerId, userId, videoUrl, caption } = await request.json()
        if (!containerId || !userId) {
            return NextResponse.json({ error: "Missing containerId or userId" }, { status: 400 })
        }

        const supabase = await getSupabaseServerClient()

        // Get User Token
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("access_token")
            .eq("id", userId)
            .single()

        if (userError || !user?.access_token) {
            return NextResponse.json({ error: "User not found" }, { status: 404 })
        }

        // Check Status
        const status = await getContainerStatus(user.access_token, containerId)
        console.log(`[PublishReel] Container ${containerId} status: ${status}`)

        if (status === "IN_PROGRESS") {
            return NextResponse.json({
                status: "IN_PROGRESS",
                message: "Video still processing"
            }, { status: 202 })
        }

        if (status !== "FINISHED") {
            // direct-post'un actigi PENDING kaydini kapat (yoksa yeni kayit)
            const { data: failUpd } = await supabase
                .from("reels_posts")
                .update({ status: "FAILED", error_message: `Processing failed with status: ${status}` })
                .eq("user_id", userId)
                .eq("ig_container_id", containerId)
                .in("status", ["PENDING", "PUBLISHING"])
                .select("id")
            if (!failUpd?.length) {
                await supabase.from("reels_posts").insert({
                    user_id: userId,
                    video_url: videoUrl || "",
                    caption: caption || "",
                    ig_container_id: containerId,
                    status: "FAILED",
                    error_message: `Processing failed with status: ${status}`
                })
            }
            return NextResponse.json({ error: `Container status: ${status}` }, { status: 400 })
        }

        // ATOMIK CLAIM: ayni container icin es zamanli iki cagri (polling
        // cakismasi/retry) iki kez publish edemesin — PENDING → PUBLISHING
        const { data: claim } = await supabase
            .from("reels_posts")
            .update({ status: "PUBLISHING" })
            .eq("user_id", userId)
            .eq("ig_container_id", containerId)
            .eq("status", "PENDING")
            .select("id")
        if (!claim?.length) {
            // PENDING kayit yok: ya eski cagiran (direct-post disi) ya da baska
            // cagri isliyor/bitirdi — duruma gore cevapla
            const { data: existing } = await supabase
                .from("reels_posts")
                .select("id, status, ig_media_id")
                .eq("user_id", userId)
                .eq("ig_container_id", containerId)
                .limit(1)
            if (existing?.length) {
                const row = existing[0]
                if (row.status === "PUBLISHED")
                    return NextResponse.json({ success: true, status: "PUBLISHED", mediaId: row.ig_media_id, alreadyPublished: true })
                if (row.status === "PUBLISHING")
                    return NextResponse.json({ error: "Bu container şu anda başka bir çağrıda yayınlanıyor" }, { status: 409 })
                // FAILED vb. — duşerek yeniden dener (asagida insert fallback var)
            }
        }

        // Publish!
        const mediaId = await publishContainer(user.access_token, containerId)
        console.log(`[PublishReel] Published! Media ID: ${mediaId}`)

        // Log success: claim edilen kaydi guncelle; kayit yoksa (eski cagiran) insert
        const nowIso = new Date().toISOString()
        const { data: okUpd } = await supabase
            .from("reels_posts")
            .update({ status: "PUBLISHED", ig_media_id: mediaId, published_at: nowIso, error_message: null })
            .eq("user_id", userId)
            .eq("ig_container_id", containerId)
            .in("status", ["PUBLISHING", "PENDING", "FAILED"])
            .select("id")
        if (!okUpd?.length) {
            await supabase.from("reels_posts").insert({
                user_id: userId,
                video_url: videoUrl || "",
                caption: caption || "",
                ig_container_id: containerId,
                ig_media_id: mediaId,
                status: "PUBLISHED",
                published_at: nowIso
            })
        }

        return NextResponse.json({
            success: true,
            status: "PUBLISHED",
            mediaId
        })

    } catch (error: any) {
        console.error("[PublishReel] Error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
