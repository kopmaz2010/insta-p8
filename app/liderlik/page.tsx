/* @ts-nocheck */

// G2: Aylik liderlik tablosu — DM'e sigmayan zengin deneyim web'de (plan §2 web_url deseni)
// Kullanim: /liderlik?h=<instagram_kullanici_adi>

import { getSupabaseServerClient } from "@/lib/supabase-server"
import Image from "next/image"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Liderlik Tablosu — Fabrika Puan",
  description: "Bu ayın en aktif Fabrika Puan üyeleri.",
}

const MEDALS = ["🥇", "🥈", "🥉"]

export default async function LiderlikPage({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const params = await searchParams
  const handle = typeof params?.h === "string" ? params.h.trim() : ""

  let programName = "Fabrika Puan"
  let rows: { username: string; total: number }[] | null = null
  let accountName = handle

  if (handle) {
    const supabase = await getSupabaseServerClient()
    const { data: account } = await supabase.from("users").select("id, username").eq("username", handle).single()
    if (account) {
      const { data: settings } = await supabase
        .from("gamification_settings")
        .select("program_name, active")
        .eq("user_id", account.id)
        .single()
      if (settings?.active) {
        programName = settings.program_name || programName
        accountName = account.username
        const now = new Date()
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
        const { data } = await supabase.rpc("get_leaderboard", {
          p_user_id: account.id,
          p_since: monthStart,
          p_limit: 20,
        })
        rows = data || []
      }
    }
  }

  const monthLabel = new Date().toLocaleDateString("tr-TR", { month: "long", year: "numeric" })

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <Image src="/fabrika-logo.png" alt="Fabrika Müzik" width={72} height={72} className="rounded-xl" />
          <h1 className="text-2xl font-bold text-center">🏆 {programName} Liderlik Tablosu</h1>
          <p className="text-sm text-neutral-400 text-center">
            {accountName ? `@${accountName} · ` : ""}
            {monthLabel} — bu ay kazanılan puanlara göre
          </p>
        </div>

        {rows === null ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-400">
            Tablo bulunamadı. Bağlantıyı Instagram DM&apos;inden açtığından emin ol. 🙏
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-400">
            Bu ay henüz puan kazanan olmadı — ilk sen ol! Gönderilere yorum yap, puanları topla. ⭐
          </div>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={`${r.username}-${i}`}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                  i < 3 ? "border-orange-500/50 bg-orange-500/10" : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="w-8 text-lg text-center">{MEDALS[i] || `${i + 1}.`}</span>
                  <span className="font-medium">{r.username ? `@${r.username}` : "Gizli Üye"}</span>
                </span>
                <span className="font-bold text-orange-400">⭐ {r.total}</span>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-8 text-center text-xs text-neutral-500">
          Puan kazanmak için gönderilere yorum yap, DM&apos;den &quot;QUIZ&quot; çöz, &quot;DAVET&quot; ile
          arkadaşını getir. Bakiyen için DM&apos;den &quot;PUAN&quot; yaz. 🎶
          <br />
          Fabrika Müzik — New Generation Collective
        </p>
      </div>
    </main>
  )
}
