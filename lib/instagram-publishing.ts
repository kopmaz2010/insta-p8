import { getSupabaseServerClient } from "@/lib/supabase-server"

interface ContainerResponse {
    id: string
}

interface PublishResponse {
    id: string,
    error?: any
}

export type TrialStrategy = 'MANUAL' | 'SS_PERFORMANCE'

// Hesap basina gunluk deneme reelsi kotasi (UTC gunu). Sayac webhook_events
// defterinde 'trial_reel' event'i olarak tutulur (event_key = trial_<containerId>).
const DAILY_TRIAL_LIMIT = Number(process.env.DAILY_TRIAL_LIMIT || 15)

export async function underTrialQuota(supabase: any, userId: any): Promise<boolean> {
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const { count, error } = await supabase
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "trial_reel")
        .gte("processed_at", dayStart.toISOString())
    if (error) {
        console.error("[TrialQuota] sayim hatasi:", error)
        return true // sayac dusarse paylasimi engelleme
    }
    return (count || 0) < DAILY_TRIAL_LIMIT
}

export async function recordTrialPost(supabase: any, userId: any, containerId: string): Promise<void> {
    const { error } = await supabase
        .from("webhook_events")
        .insert({ event_key: `trial_${containerId}`, event_type: "trial_reel", user_id: userId })
    if (error && error.code !== "23505") console.error("[TrialQuota] kayit hatasi:", error)
}

/**
 * Creates a media container for a Reel
 * trialStrategy verilirse reel "deneme reelsi" (trial reel) olarak paylaşılır:
 * önce yalnızca takipçi-olmayanlara gösterilir. SS_PERFORMANCE = iyi performansta
 * otomatik herkese açılır, MANUAL = Instagram uygulamasından elle açılır.
 * (Hesapta trial reels özelliği yoksa Meta container aşamasında hata döner.)
 */
export async function createReelsContainer(accessToken: string, videoUrl: string, caption: string, coverUrl?: string, trialStrategy?: TrialStrategy | null, aiGenerated?: boolean): Promise<string> {
    const endpoint = `https://graph.instagram.com/me/media`

    const params = new URLSearchParams({
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption,
        access_token: accessToken
    })

    // Optional: Cover URL
    if (coverUrl) {
        params.append('cover_url', coverUrl)
    }

    // Optional: Trial reel (deneme reelsi)
    if (trialStrategy) {
        params.append('trial_params', JSON.stringify({ graduation_strategy: trialStrategy }))
    }

    // Optional: Yapay zeka etiketi — Instagram'in resmi "AI info" beyani.
    // Yasal AI vurgusu icin true gonderilir; IG icerikte AI etiketi gosterir.
    if (aiGenerated) {
        params.append('is_ai_generated', 'true')
    }

    const res = await fetch(`${endpoint}?${params.toString()}`, { method: 'POST' })
    const data = await res.json()

    if (data.error) {
        throw new Error(`IG Container Error: ${data.error.message}`)
    }

    return data.id
}

/**
 * Checks the status of a media container
 * Status can be: EXPIRED, ERROR, FILTERED, IN_PROGRESS, FINISHED
 */
export async function getContainerStatus(accessToken: string, containerId: string): Promise<string> {
    const url = `https://graph.instagram.com/${containerId}?fields=status_code&access_token=${accessToken}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.error) {
        throw new Error(`IG Status Error: ${data.error.message}`)
    }

    return data.status_code // e.g. 'FINISHED'
}

/**
 * Publishes the container once it is FINISHED
 */
export async function publishContainer(accessToken: string, containerId: string): Promise<string> {
    const endpoint = `https://graph.instagram.com/me/media_publish`
    const params = new URLSearchParams({
        creation_id: containerId,
        access_token: accessToken
    })

    const res = await fetch(`${endpoint}?${params.toString()}`, { method: 'POST' })
    const data = await res.json()

    if (data.error) {
        throw new Error(`IG Publish Error: ${data.error.message}`)
    }

    return data.id // The final Media ID
}
