import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("error", error)
    return NextResponse.redirect(redirectUrl)
  }

  if (code) {
    const redirectUrl = new URL("/", request.url)
    redirectUrl.searchParams.set("code", code)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.json({ error: "Invalid callback" }, { status: 400 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code } = body
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 })

    // 1. Env Vars
    const clientId = process.env.INSTAGRAM_APP_ID
    const clientSecret = process.env.INSTAGRAM_APP_SECRET
    const redirectUri = process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Missing Env Vars: Check INSTAGRAM_APP_ID")
    }

    // 2. Exchange Code for Short Token
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    })

    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    })

    const tokenData = await tokenRes.json()
    if (!tokenRes.ok) {
      if (tokenData.error_message?.includes("authorization code has been used")) {
        // Harmless double-fire from React StrictMode or double clicks
        return NextResponse.json({ error: "Code already used" }, { status: 400 })
      }
      console.error("[v0] 🔴 Token Error:", JSON.stringify(tokenData, null, 2))
      return NextResponse.json({ error: tokenData.error_description || "Token failed" }, { status: 400 })
    }

    const shortToken = tokenData.access_token
    const loginUserId = tokenData.user_id.toString()

    // 3. Exchange for Long Token (60 Days)
    // FIX (9 Tem): exchange basarisizsa ESKIDEN sessizce 1 saatlik kisa token
    // kaydediliyordu — 1 saat sonra hesap "koptu" (fabrika_muzik kazasi).
    // Artik basarisiz exchange'de DB'ye HIC yazmadan acik hata donuyoruz.
    const longLivedUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortToken}`
    const longRes = await fetch(longLivedUrl)
    const longData = await longRes.json()
    if (!longData.access_token) {
      console.error("[v0] 🔴 Long-lived token exchange basarisiz:", JSON.stringify(longData))
      return NextResponse.json(
        { error: "Instagram kalıcı oturum anahtarı veremedi (geçici). Lütfen 'Instagram'ı Bağla' ile tekrar dene." },
        { status: 502 },
      )
    }
    const accessToken = longData.access_token
    const expiresIn = longData.expires_in || 5184000

    // FAZ1-A1: hesabi comments+messages webhook'una OTOMATIK abone et
    try {
      const subRes = await fetch(
        `https://graph.instagram.com/v23.0/me/subscribed_apps?subscribed_fields=comments,messages&access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST" },
      )
      const subJson = await subRes.json()
      console.log("[v0] 🔔 Webhook aboneligi:", JSON.stringify(subJson))
    } catch (e) {
      console.error("[v0] 🔴 Webhook aboneligi basarisiz:", e)
    }

    // 4. Get Username + IG Professional Account ID (webhook-matching ID)
    // Per Meta docs: /me?fields=user_id returns the IG_ID that matches webhook entry.id
    // https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started
    let username = ""
    let businessAccountId = ""
    let identityOk = false

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const meRes = await fetch(
          `https://graph.instagram.com/v24.0/me?fields=user_id,username&access_token=${accessToken}`
        )
        const meData = await meRes.json()
        console.log(`[v0] 📋 /me response (deneme ${attempt}):`, JSON.stringify(meData))

        if (meData.username) username = meData.username
        if (meData.user_id) {
          businessAccountId = meData.user_id.toString()
          identityOk = true
          console.log(`[v0] 🎯 IG Professional Account ID: ${businessAccountId}`)
          break
        }
      } catch (e) {
        console.error(`[v0] /me denemesi ${attempt} basarisiz:`, e)
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    // 6. Save/Update User
    const supabase = await getSupabaseServerClient()

    // FIX (9 Tem): /me kimligi alinamadiysa MEVCUT kaydin kimlik alanlarini
    // (username/business_account_id/page_id) fallback degerlerle EZME —
    // sadece token'i tazele. "user_XXXX + bos medya + webhook eslesmiyor"
    // kazasinin ikinci yarisi buydu.
    const { data: existing } = await supabase
      .from("users")
      .select("username, business_account_id")
      .eq("id", loginUserId)
      .single()

    if (!identityOk && existing?.business_account_id) {
      username = existing.username
      businessAccountId = String(existing.business_account_id)
      console.log(`[v0] 🛡️ /me basarisiz — mevcut kimlik korundu: ${username} / ${businessAccountId}`)
    } else if (!identityOk) {
      // yeni hesap + kimlik alinamadi: eski fallback davranisi (sonradan SQL ile duzeltilir)
      username = `user_${loginUserId}`
      businessAccountId = loginUserId
    }

    const updates: any = {
      username,
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      business_account_id: businessAccountId,
      page_id: businessAccountId, // Always keep in sync
    }

    console.log(`[v0] 💾 Saving user: ${username} | id=${loginUserId} | biz_id=${businessAccountId}`)

    const { error: upsertError } = await supabase
      .from("users")
      .upsert({ id: loginUserId, ...updates }, { onConflict: "id" })

    if (upsertError) throw upsertError

    const response = NextResponse.json({ success: true, username, userId: loginUserId })
    response.cookies.set("insta_session", JSON.stringify({ username, userId: loginUserId }), {
      path: "/",
      maxAge: expiresIn,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    return response

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
