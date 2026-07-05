import { getSupabaseServerClient } from "@/lib/supabase-server"

interface ContainerResponse {
    id: string
}

interface PublishResponse {
    id: string,
    error?: any
}

export type TrialStrategy = 'MANUAL' | 'SS_PERFORMANCE'

/**
 * Creates a media container for a Reel
 * trialStrategy verilirse reel "deneme reelsi" (trial reel) olarak paylaşılır:
 * önce yalnızca takipçi-olmayanlara gösterilir. SS_PERFORMANCE = iyi performansta
 * otomatik herkese açılır, MANUAL = Instagram uygulamasından elle açılır.
 * (Hesapta trial reels özelliği yoksa Meta container aşamasında hata döner.)
 */
export async function createReelsContainer(accessToken: string, videoUrl: string, caption: string, coverUrl?: string, trialStrategy?: TrialStrategy | null): Promise<string> {
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
