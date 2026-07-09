/* @ts-nocheck */
"use client"

// ============================================================
// MESAJ OZELLESTIRME PANELI
// 1) Public yorum cevabi varyasyonlari (yoruma verilen "DM'ne bak!" tarzi
//    cevaplar — maks 5, rastgele secilir)
// 2) Takip kapisi karti: baslik, alt baslik, buton etiketleri (canli onizleme)
// ============================================================

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { SlidersHorizontal, Plus, Trash2, Save, Loader2, MessageSquareText, Lock } from "lucide-react"

const cardCls = "rounded-2xl border border-white/10 bg-white/5 p-5"
const labelCls = "text-xs font-medium text-neutral-400"
const inputCls = "bg-black/40 border-white/10 text-white"

export function CustomizationManager() {
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [replies, setReplies] = useState<string[]>([])
  const [gateTitle, setGateTitle] = useState("")
  const [gateSubtitle, setGateSubtitle] = useState("")
  const [btnProfile, setBtnProfile] = useState("")
  const [btnFollow, setBtnFollow] = useState("")

  useEffect(() => {
    const id = localStorage.getItem("ig_user_id")
    setUsername(localStorage.getItem("ig_username") || "hesabin")
    setUserId(id)
    if (!id) {
      setLoading(false)
      return
    }
    fetch(`/api/customization?userId=${id}`)
      .then((r) => r.json())
      .then((d) => {
        setReplies(d.public_replies || [])
        setGateTitle(d.gate_title || "")
        setGateSubtitle(d.gate_subtitle || "")
        setBtnProfile(d.gate_btn_profile || "")
        setBtnFollow(d.gate_btn_follow || "")
      })
      .catch(() => toast.error("Ayarlar yüklenemedi"))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/customization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          public_replies: replies,
          gate_title: gateTitle,
          gate_subtitle: gateSubtitle,
          gate_btn_profile: btnProfile,
          gate_btn_follow: btnFollow,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Hata")
      toast.success("Özelleştirme kaydedildi ✅")
    } catch (e: any) {
      toast.error(e.message || "Kaydedilemedi")
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-24 text-neutral-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  if (!userId) return <div className="text-neutral-400 p-8">Önce bir Instagram hesabı bağlamalısın.</div>

  const previewSubtitle = gateSubtitle.replaceAll("{username}", username)

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <SlidersHorizontal className="w-6 h-6 text-orange-400" />
        <h1 className="text-2xl font-bold text-white">Mesaj Özelleştirme</h1>
      </div>
      <p className="text-sm text-neutral-400 mb-6">
        Yorumlara verilen public cevaplar ve takip zorunluluğu kartı — hepsi bu ekrandan, hesabına özel.
      </p>

      {/* 1) PUBLIC CEVAP VARYASYONLARI */}
      <div className={`${cardCls} mb-4`}>
        <div className="flex items-center gap-2 mb-1">
          <MessageSquareText className="w-4 h-4 text-neutral-400" />
          <h2 className="font-semibold text-white">Yorum Cevabı Varyasyonları</h2>
        </div>
        <p className="text-xs text-neutral-400 mb-3">
          Anahtar kelime yakalanınca yoruma public olarak yazılan mesajlar. Her seferinde aralarından rastgele biri
          seçilir (bot izlenimini azaltır). En fazla 5 varyasyon.
        </p>
        <div className="space-y-2">
          {replies.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-xs text-neutral-500 font-mono">{i + 1}.</span>
              <Input
                className={inputCls}
                value={r}
                placeholder={`Varyasyon ${i + 1} — örn: DM'ne bak! 📩`}
                onChange={(e) => setReplies(replies.map((x, xi) => (xi === i ? e.target.value : x)))}
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={replies.length <= 1}
                onClick={() => setReplies(replies.filter((_x, xi) => xi !== i))}
              >
                <Trash2 className="w-4 h-4 text-neutral-500" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={replies.length >= 5}
          onClick={() => setReplies([...replies, ""])}
        >
          <Plus className="w-4 h-4 mr-1" /> Varyasyon ekle ({replies.length}/5)
        </Button>
        <p className="text-[11px] text-neutral-500 mt-2">
          Not: Oyunlaştırma açıksa puan bilgisi ("⭐ +10 puan...") seçilen varyasyonun sonuna otomatik eklenir.
        </p>
      </div>

      {/* 2) TAKIP KAPISI KARTI */}
      <div className={cardCls}>
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-neutral-400" />
          <h2 className="font-semibold text-white">Takip Zorunluluğu Kartı</h2>
        </div>
        <p className="text-xs text-neutral-400 mb-4">
          "Takip et" şartlı kurallarda, takipçi olmayanlara DM'de giden kart. <code>{"{username}"}</code> yazarsan
          hesap adınla otomatik değiştirilir.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Kart başlığı (maks 80)</label>
              <Input className={inputCls} maxLength={80} value={gateTitle} onChange={(e) => setGateTitle(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Alt başlık (maks 80)</label>
              <Input className={inputCls} maxLength={80} value={gateSubtitle} onChange={(e) => setGateSubtitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>1. buton — profile götürür (maks 20)</label>
                <Input className={inputCls} maxLength={20} value={btnProfile} onChange={(e) => setBtnProfile(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>2. buton — takip doğrulama (maks 20)</label>
                <Input className={inputCls} maxLength={20} value={btnFollow} onChange={(e) => setBtnFollow(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Canli onizleme — Instagram DM karti */}
          <div>
            <label className={labelCls}>Önizleme</label>
            <div className="mt-1 rounded-2xl bg-neutral-800 p-4 max-w-[280px]">
              <p className="text-sm font-semibold text-white">{gateTitle || "Kart başlığı"}</p>
              <p className="text-xs text-neutral-400 mt-1">{previewSubtitle || "Alt başlık"}</p>
              <div className="mt-3 space-y-2">
                <div className="rounded-lg bg-neutral-700/60 text-center py-2 text-sm text-blue-300 font-medium">
                  {btnProfile || "1. buton"}
                </div>
                <div className="rounded-lg bg-neutral-700/60 text-center py-2 text-sm text-blue-300 font-medium">
                  {btnFollow || "2. buton"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Button onClick={save} disabled={saving} className="mt-5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Kaydet
        </Button>
      </div>
    </div>
  )
}
