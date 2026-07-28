/* @ts-nocheck */
"use client"

// ZAMANLANMIS PAYLASIMLAR — scheduled_posts kuyrugu.
// Bu liste panelde yoktu: kullanici 15 reels planlayip Publisher'da hicbir sey
// gormeyince "kayboldu mu?" diye endiseleniyordu. Content Pool (rotasyon) ile
// KARISTIRILMAMALI — o ayri bir sistem.

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CalendarClock, Loader2, RefreshCw, Trash2, CheckCircle2, AlertTriangle, Clock, FlaskConical, Bot } from "lucide-react"

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

export function ScheduledQueue({ userId }: { userId: string }) {
  const [posts, setPosts] = useState<any[]>([])
  const [ozet, setOzet] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/scheduler/queue?userId=${userId}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "Yüklenemedi")
      setPosts(d.posts || [])
      setOzet(d.ozet)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (userId) load()
  }, [userId])

  const iptal = async (id: string) => {
    if (!confirm("Bu zamanlanmış paylaşım iptal edilsin mi? (Yayınlanmış gönderilere dokunulmaz)")) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/scheduler/queue?id=${id}`, { method: "DELETE" })
      if (res.ok) setPosts((p) => p.filter((x) => x.id !== id))
      else {
        const d = await res.json()
        alert(d.error || "İptal edilemedi")
      }
    } finally {
      setBusyId(null)
    }
  }

  const bekleyenler = posts.filter((p) => ["pending", "processing", "publishing"].includes(p.status))
  const digerleri = posts.filter((p) => !["pending", "processing", "publishing"].includes(p.status)).reverse()

  return (
    <Card className="bg-black/40 border-white/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-orange-400" />
            Zamanlanmış Paylaşımlar
          </CardTitle>
          <p className="text-sm text-neutral-400 mt-1">
            Belirli saate planlanmış reels/carousel kuyruğu (Content Pool rotasyonundan ayrıdır).
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm" className="border-white/20 bg-transparent">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {ozet && (
          <div className="flex gap-3 text-xs">
            <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {ozet.bekleyen} bekliyor
            </span>
            <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              {ozet.yayinlanan} yayınlandı
            </span>
            {ozet.hatali > 0 && (
              <span className="px-2 py-1 rounded-lg bg-red-500/10 text-red-300 border border-red-500/20">
                {ozet.hatali} hata
              </span>
            )}
          </div>
        )}

        {loading && !posts.length && (
          <div className="flex justify-center py-10 text-neutral-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && !posts.length && !error && (
          <p className="text-sm text-neutral-500 py-8 text-center">Bu hesapta zamanlanmış paylaşım yok.</p>
        )}

        {bekleyenler.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Yaklaşan</p>
            {bekleyenler.map((p) => (
              <Row key={p.id} p={p} onIptal={iptal} busy={busyId === p.id} />
            ))}
          </div>
        )}

        {digerleri.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Geçmiş</p>
            {digerleri.slice(0, 15).map((p) => (
              <Row key={p.id} p={p} onIptal={iptal} busy={busyId === p.id} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ p, onIptal, busy }: any) {
  const bekliyor = ["pending", "processing", "publishing"].includes(p.status)
  const hata = p.status === "error"
  const Icon = hata ? AlertTriangle : p.status === "published" ? CheckCircle2 : Clock
  const renk = hata ? "text-red-400" : p.status === "published" ? "text-emerald-400" : "text-amber-400"

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <Icon className={`w-4 h-4 shrink-0 ${renk}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-white font-medium">{fmt(p.scheduledAt)}</span>
          {p.asTrial && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 flex items-center gap-1">
              <FlaskConical className="w-3 h-3" /> deneme
            </span>
          )}
          {p.asAi && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 flex items-center gap-1">
              <Bot className="w-3 h-3" /> AI etiketli
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-400 truncate" title={p.caption}>
          {p.fileName} {p.caption ? `— ${p.caption.split("\n")[0]}` : ""}
        </p>
        {hata && p.error && <p className="text-xs text-red-400/90 mt-0.5">{p.error}</p>}
      </div>
      {bekliyor && (
        <Button
          onClick={() => onIptal(p.id)}
          disabled={busy}
          variant="ghost"
          size="sm"
          className="text-neutral-400 hover:text-red-400 shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </Button>
      )}
    </div>
  )
}
