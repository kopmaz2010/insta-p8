/* @ts-nocheck */
"use client"

// Takip Durumu: etkilesime girmis kisiler takip ediyor mu?

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, UserCheck, UserX, HelpCircle, Search, Users } from "lucide-react"
import { FollowerExport } from "@/components/dashboard/FollowerExport"

export default function FollowersPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState("")

  const run = async () => {
    const userId = localStorage.getItem("ig_user_id")
    if (!userId) {
      setError("Önce hesap seç / bağla.")
      return
    }
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/follower-check?userId=${userId}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "Hata")
      setData(d)
    } catch (e: any) {
      setError(e.message || "Kontrol başarısız")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-1">
        <Users className="w-6 h-6 text-orange-400" />
        <h1 className="text-2xl font-bold text-white">Takip Durumu</h1>
      </div>
      <p className="text-sm text-neutral-400 mb-4">
        Seninle <strong>etkileşime giren</strong> kişiler (DM atan, yorumdan puan kazanan) seni takip ediyor mu?
      </p>
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-yellow-200/90 text-xs px-4 py-3 mb-5">
        <strong>İki yöntem var:</strong> (1) Aşağıdaki buton — canlı API ile yalnızca <strong>etkileşimli</strong>
        kişileri kontrol eder (anlık). (2) En altta <strong>Instagram Export</strong> — <strong>tüm</strong>
        takipçi/takip listeni verir (Instagram'ın resmi indirmesi; tam liste için bunu kullan).
      </div>

      <h2 className="text-sm font-bold text-neutral-300 mb-2">Yöntem 1 — Canlı etkileşim kontrolü</h2>
      <Button onClick={run} disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
        {loading ? "Kontrol ediliyor..." : "Takip Durumunu Kontrol Et"}
      </Button>
      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

      {data && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Kontrol edilen" value={data.total} icon={<Users className="w-4 h-4" />} color="text-white" />
            <Stat label="Takip ediyor" value={data.followers} icon={<UserCheck className="w-4 h-4" />} color="text-emerald-400" />
            <Stat label="Takip etmiyor" value={data.nonFollowers} icon={<UserX className="w-4 h-4" />} color="text-red-400" />
            <Stat label="Belirsiz" value={data.unknown} icon={<HelpCircle className="w-4 h-4" />} color="text-neutral-400" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 divide-y divide-white/5">
            {data.people.length === 0 && (
              <div className="p-6 text-center text-sm text-neutral-500">{data.note || "Etkileşim yok."}</div>
            )}
            {data.people.map((p: any) => (
              <a
                key={p.igsid}
                href={`https://instagram.com/${p.username}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/5"
              >
                <span className="flex-1 text-sm text-white truncate">@{p.username}</span>
                {p.follows === true && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <UserCheck className="w-3.5 h-3.5" /> Takip ediyor
                  </span>
                )}
                {p.follows === false && (
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <UserX className="w-3.5 h-3.5" /> Takip etmiyor
                  </span>
                )}
                {p.follows === null && (
                  <span className="flex items-center gap-1 text-xs text-neutral-500">
                    <HelpCircle className="w-3.5 h-3.5" /> Belirsiz
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Yontem 2 — tam liste (Instagram export ZIP) */}
      <FollowerExport />
    </div>
  )
}

function Stat({ label, value, icon, color }: any) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className={`flex items-center gap-1.5 ${color}`}>
        {icon}
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="text-[11px] text-neutral-500 mt-1">{label}</p>
    </div>
  )
}
