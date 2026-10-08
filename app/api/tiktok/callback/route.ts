/* @ts-nocheck */

// TikTok hesabi bagla — adim 2: TikTok ?code&state ile doner; kod token'a cevrilir,
// hesap tiktok_accounts'a yazilir ve state'teki InstaAuto hesabina baglanir. (8 Eki 2026)

import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { exchangeCode, getBusiness, readState } from "@/lib/tiktok"

function geri(request: Request, params: Record<string, string>) {
  const u = new URL("/", request.url)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return NextResponse.redirect(u)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const hata = url.searchParams.get("error")
  if (hata) return geri(request, { error: `tiktok: ${hata}` })
  const userId = readState(url.searchParams.get("state"))
  if (!code || !userId) return geri(request, { error: "tiktok: kod/state gecersiz" })

  try {
    const t = await exchangeCode(code)
    let profil: any = null
    try { profil = await getBusiness(t.access_token, t.open_id) } catch {}
    const supabase = await getSupabaseServerClient()
    const { error } = await supabase.from("tiktok_accounts").upsert({
      open_id: t.open_id,
      user_id: userId,
      username: profil?.username || null,
      display_name: profil?.display_name || null,
      profile_image: profil?.profile_image || null,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      token_expires_at: t.token_expires_at,
      refresh_expires_at: t.refresh_expires_at,
      scope: t.scope || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "open_id" })
    if (error) throw error
    return geri(request, { tiktok: "bagli", tiktok_user: profil?.username || t.open_id })
  } catch (e: any) {
    console.error("[tiktok] callback hatasi:", e)
    return geri(request, { error: `tiktok: ${String(e.message || e).slice(0, 120)}` })
  }
}
