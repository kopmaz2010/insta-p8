/* @ts-nocheck */
"use client"

// ============================================================
// CHATBOT (AI YONETICI) SAYFASI
// Hicbir otomasyon/oyunlastirma komutu eslesmeyen DM'lere, asagidaki
// kurallarla (persona) Claude uzerinden cevap veren asistanin yonetimi.
// Acik/kapali anahtari + kural metni buradan yonetilir.
// ============================================================

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { Bot, Save, Loader2, MessageCircleQuestion, ShieldCheck, Power } from "lucide-react"

export function ChatbotManager() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [persona, setPersona] = useState("")
  const [aiMode, setAiMode] = useState<"local" | "api">("local")
  const [aiPending, setAiPending] = useState(0)
  const [username, setUsername] = useState("")

  useEffect(() => {
    const id = localStorage.getItem("ig_user_id")
    setUsername(localStorage.getItem("ig_username") || "")
    setUserId(id)
    if (!id) {
      setLoading(false)
      return
    }
    fetch(`/api/gamification/settings?userId=${id}`)
      .then((r) => r.json())
      .then((s) => {
        setEnabled(s.ai?.enabled === true)
        setPersona(s.ai?.persona || "")
        setAiMode(s.aiMode === "api" ? "api" : "local")
        setAiPending(s.aiPending || 0)
      })
      .catch(() => toast.error("Chatbot ayarları yüklenemedi"))
      .finally(() => setLoading(false))
  }, [])

  const save = async (overrideEnabled?: boolean) => {
    setSaving(true)
    try {
      const res = await fetch("/api/gamification/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          ai: { enabled: overrideEnabled ?? enabled, persona },
        }),
      })
      if (!res.ok) throw new Error()
      toast.success("Chatbot ayarları kaydedildi ✅")
    } catch {
      toast.error("Kaydedilemedi")
    } finally {
      setSaving(false)
    }
  }

  // Anahtar degisince aninda kaydet — "site uzerinden kapatip acabilelim"
  const toggle = async (v: boolean) => {
    setEnabled(v)
    try {
      const res = await fetch("/api/gamification/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ai: { enabled: v, persona } }),
      })
      if (!res.ok) throw new Error()
      toast.success(v ? "Chatbot açıldı ✅" : "Chatbot kapatıldı")
    } catch {
      setEnabled(!v) // kaydedilemedi: anahtar gercek durumu gostersin
      toast.error("Kaydedilemedi — durum değişmedi")
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-24 text-neutral-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  if (!userId) return <div className="text-neutral-400 p-8">Önce bir Instagram hesabı bağlamalısın.</div>

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-1">
        <Bot className="w-6 h-6 text-orange-400" />
        <h1 className="text-2xl font-bold text-white">Chatbot</h1>
      </div>
      <p className="text-sm text-neutral-400 mb-6">
        {username && <span className="text-neutral-300">@{username}</span>} hesabında, hiçbir otomasyon kuralı veya
        oyunlaştırma komutuyla eşleşmeyen DM'lere aşağıdaki kurallarla 7/24 cevap verir.
      </p>

      {/* Acik/Kapali */}
      <div
        className={`rounded-2xl border p-5 mb-4 flex items-center justify-between transition-colors ${
          enabled ? "border-green-500/40 bg-green-500/10" : "border-white/10 bg-white/5"
        }`}
      >
        <div className="flex items-center gap-3">
          <Power className={`w-5 h-5 ${enabled ? "text-green-400" : "text-neutral-500"}`} />
          <div>
            <div className="font-semibold text-white">{enabled ? "Chatbot AÇIK" : "Chatbot KAPALI"}</div>
            <div className="text-xs text-neutral-400">
              {enabled
                ? "Eşleşmeyen DM'lere otomatik cevap veriliyor"
                : "Hiçbir DM'e serbest sohbet cevabı verilmiyor — sadece kurallı otomasyonlar çalışıyor"}
            </div>
          </div>
        </div>
        <Switch checked={enabled} disabled={saving} onCheckedChange={toggle} />
      </div>

      {/* Calisma modu */}
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 text-sky-200/90 text-xs px-4 py-3 mb-4">
        {aiMode === "api" ? (
          <>
            <strong>Mod: API</strong> — cevaplar Vercel üzerinden anında üretilir (ANTHROPIC_API_KEY tanımlı).
          </>
        ) : (
          <>
            <strong>Mod: Yerel Köprü</strong> — API anahtarı gerekmez. Eşleşmeyen DM'ler kuyruğa alınır; Mac'te
            çalışan <code className="font-mono">scripts/chatbot_kopru.py</code> cevapları yerel modelle (Ollama)
            üretip gönderir. Script çalışmıyorsa mesajlar 20 saat bekler, sonra cevapsız düşer.
            {aiPending > 0 && (
              <span className="ml-2 inline-block rounded-md bg-amber-500/20 text-amber-200 px-2 py-0.5">
                Kuyrukta {aiPending} mesaj bekliyor
              </span>
            )}
          </>
        )}
      </div>

      {/* Kurallar */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-2 mb-1">
          <MessageCircleQuestion className="w-4 h-4 text-neutral-400" />
          <h2 className="font-semibold text-white">Chatbot Kuralları</h2>
        </div>
        <p className="text-xs text-neutral-400 mb-3">
          Kişilik, ton, yasaklar ve özel durumlar — chatbot her cevabında bu kurallara uyar. (SENARYO, İLETİŞİM
          PROFİLİ, STİL KILAVUZU, SINIRLAMALAR... formatında yazabilirsin.)
        </p>
        <Textarea
          className="bg-black/40 border-white/10 text-white min-h-[360px] font-mono text-xs"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="SENARYO: Bu asistan ... için tasarlanmıştır.&#10;İLETİŞİM PROFİLİ: ...&#10;SINIRLAMALAR: ..."
        />
        <div className="flex items-center justify-between mt-4">
          <p className="text-[11px] text-neutral-500 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Cevaplar yalnızca 24 saatlik etkileşim penceresinde gider; tüm
            spam limitleri ve devre kesici chatbot için de geçerli.
          </p>
          <Button onClick={() => save()} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Kaydet
          </Button>
        </div>
      </div>
    </div>
  )
}
