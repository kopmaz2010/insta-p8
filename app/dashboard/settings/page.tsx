/* @ts-nocheck */
"use client"

// SISTEM SAGLIGI — hesap basina otomasyon zincirinin durumu (/api/health).
// "Otomasyon calismiyor" sikayetinin cevabi artik bu ekranda: token mu,
// abonelik mi, Meta event mi (Tester rolu), yoksa hepsi saglikli mi.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Settings, RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle, Radio } from "lucide-react"

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState("")

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/health")
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "Hata")
      setData(d)
    } catch (e: any) {
      setError(e.message || "Sağlık kontrolü başarısız")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-orange-400" />
          <h1 className="text-2xl font-bold text-white">Sistem Sağlığı</h1>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" className="border-white/20 bg-transparent">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Yenile
        </Button>
      </div>
      <p className="text-sm text-neutral-400 mb-6">
        Hesap başına otomasyon zinciri: token → webhook aboneliği → Meta event akışı. "Otomasyon çalışmıyor"un
        cevabı burada.
      </p>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
      {loading && !data && (
        <div className="flex items-center justify-center py-24 text-neutral-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      <div className="space-y-4">
        {data?.accounts?.map((a: any) => {
          const healthy = a.verdict === "SAĞLIKLI"
          return (
            <div
              key={a.id}
              className={`rounded-2xl border p-5 ${
                healthy ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                {healthy ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                )}
                <span className="font-semibold text-white">@{a.username}</span>
                <span className={`ml-auto text-xs font-bold ${healthy ? "text-emerald-300" : "text-red-300"}`}>
                  {a.verdict}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <HealthCell ok={a.tokenOk} label="Token" detail={a.tokenError || "geçerli"} />
                <HealthCell
                  ok={a.subscribed}
                  label="Webhook aboneliği"
                  detail={(a.subscribedFields || []).join(", ") || "yok"}
                />
                <HealthCell
                  ok={Boolean(a.lastEventAt)}
                  label="Meta event akışı"
                  detail={a.lastEventAt ? `son: ${new Date(a.lastEventAt).toLocaleString("tr-TR")}` : "hiç event yok"}
                />
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center gap-1 text-neutral-300">
                    <Radio className="w-3.5 h-3.5" />
                    <span className="font-semibold">Son 24 saat</span>
                  </div>
                  <p className="text-neutral-400 mt-1">{a.events24h} event</p>
                </div>
              </div>
              {!a.lastEventAt && a.tokenOk && a.subscribed && (
                <p className="text-[11px] text-amber-300/90 mt-3">
                  ⚠️ Token ve abonelik sağlam ama Meta hiç event göndermiyor → Meta panelde bu hesabın{" "}
                  <strong>Instagram Testers</strong> rolü ekli ve davet <strong>kabul edilmiş</strong> olmalı
                  (Standart Erişim şartı). developers.facebook.com → FabrikaShare → App roles.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-neutral-500 mt-6">
        Otomatik onarım: günlük cron webhook aboneliği düşen hesabı yeniden abone eder ve (Telegram kuruluysa)
        bildirir. Bu sayfa anlık durumu gösterir.
      </p>
    </div>
  )
}

function HealthCell({ ok, label, detail }: any) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className={`flex items-center gap-1 ${ok ? "text-emerald-300" : "text-red-300"}`}>
        {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
        <span className="font-semibold">{label}</span>
      </div>
      <p className="text-neutral-400 mt-1 truncate" title={detail}>
        {detail}
      </p>
    </div>
  )
}
