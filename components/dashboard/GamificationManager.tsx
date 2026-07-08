/* @ts-nocheck */
"use client"

// ============================================================
// OYUNLASTIRMA PANELI (ChatPlace muadili)
// Ayarlar (puan degerleri + gunluk sinirlar) · Quiz CRUD (dogru cevap
// isaretleme) · Odul CRUD · AI Yonetici (persona / iletisim kurallari)
// ============================================================

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Trophy, Plus, Trash2, Save, Loader2, Gift, Brain, Settings2, ExternalLink } from "lucide-react"

const NUMBER_FIELDS = [
  { key: "pts_comment", label: "Yorum puanı" },
  { key: "pts_reaction", label: "İfade/emoji puanı (günde 1)" },
  { key: "pts_quiz_correct", label: "Quiz doğru (+)" },
  { key: "pts_quiz_wrong", label: "Quiz yanlış (−)" },
  { key: "pts_ref_invitee", label: "Davet edilen puanı" },
  { key: "pts_ref_inviter", label: "Davet eden puanı" },
  { key: "daily_quiz_limit", label: "Günlük soru sınırı" },
  { key: "daily_points_cap", label: "Günlük max puan" },
  { key: "daily_action_cap", label: "Günlük yorum/story eylem tavanı" },
  { key: "min_follower_count", label: "Min. takipçi şartı (0 = kapalı)" },
]

const cardCls = "rounded-2xl border border-white/10 bg-white/5 p-5"
const labelCls = "text-xs font-medium text-neutral-400"
const inputCls = "bg-black/40 border-white/10 text-white"

export function GamificationManager() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<any>(null)
  const [quizzes, setQuizzes] = useState<any[]>([])
  const [rewards, setRewards] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [username, setUsername] = useState<string>("")

  useEffect(() => {
    const id = localStorage.getItem("ig_user_id")
    setUsername(localStorage.getItem("ig_username") || "")
    setUserId(id)
    if (!id) {
      setLoading(false)
      return
    }
    Promise.all([
      fetch(`/api/gamification/settings?userId=${id}`).then((r) => r.json()),
      fetch(`/api/gamification/quizzes?userId=${id}`).then((r) => r.json()),
      fetch(`/api/gamification/rewards?userId=${id}`).then((r) => r.json()),
    ])
      .then(([s, q, r]) => {
        setSettings(s.settings || { active: false })
        setQuizzes(Array.isArray(q) ? q : [])
        setRewards(Array.isArray(r) ? r : [])
      })
      .catch(() => toast.error("Veriler yüklenemedi"))
      .finally(() => setLoading(false))
  }, [])

  const saveSettings = async (extra?: any) => {
    setSaving(true)
    try {
      const res = await fetch("/api/gamification/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, settings, ...(extra || {}) }),
      })
      if (!res.ok) throw new Error()
      toast.success("Kaydedildi ✅")
    } catch {
      toast.error("Kaydedilemedi")
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
  if (!userId)
    return <div className="text-neutral-400 p-8">Önce bir Instagram hesabı bağlamalısın.</div>

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <Trophy className="w-6 h-6 text-orange-400" />
        <h1 className="text-2xl font-bold text-white">Oyunlaştırma</h1>
      </div>
      <p className="text-sm text-neutral-400 mb-6">
        Fabrika Puan sadakat sistemi — puan değerleri, quiz soruları, ödüller ve AI yönetici.
        {username && (
          <a
            href={`/liderlik?h=${encodeURIComponent(username)}`}
            target="_blank"
            className="inline-flex items-center gap-1 ml-2 text-orange-400 hover:underline"
            rel="noreferrer"
          >
            Liderlik tablosu <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </p>

      <Tabs defaultValue="settings">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="settings"><Settings2 className="w-4 h-4 mr-1" /> Ayarlar</TabsTrigger>
          <TabsTrigger value="quizzes"><Brain className="w-4 h-4 mr-1" /> Quiz Soruları</TabsTrigger>
          <TabsTrigger value="rewards"><Gift className="w-4 h-4 mr-1" /> Ödüller</TabsTrigger>
        </TabsList>

        {/* ============ AYARLAR ============ */}
        <TabsContent value="settings" className="space-y-4 mt-4">
          <div className={cardCls}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-white">Sistem aktif</div>
                <div className="text-xs text-neutral-400">Kapalıyken hiç puan verilmez, komutlar cevaplanmaz</div>
              </div>
              <Switch
                checked={settings?.active === true}
                onCheckedChange={(v) => setSettings({ ...settings, active: v })}
              />
            </div>
            <div className="mb-4">
              <label className={labelCls}>Program adı</label>
              <Input
                className={inputCls}
                value={settings?.program_name || ""}
                onChange={(e) => setSettings({ ...settings, program_name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {NUMBER_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className={labelCls}>{f.label}</label>
                  <Input
                    type="number"
                    className={inputCls}
                    value={settings?.[f.key] ?? 0}
                    onChange={(e) => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
                  />
                </div>
              ))}
              <div>
                <label className={labelCls}>Lansman çarpanı (2 = 2x puan)</label>
                <Input
                  type="number"
                  step="0.1"
                  className={inputCls}
                  value={settings?.launch_multiplier ?? 1}
                  onChange={(e) => setSettings({ ...settings, launch_multiplier: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
              {[
                { key: "quiz_enabled", label: "Quiz açık" },
                { key: "referral_enabled", label: "Davet programı açık" },
                { key: "story_enabled", label: "Story puanı (50k+ takipçi şartı!)" },
              ].map((f) => (
                <div key={f.key} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
                  <span className="text-sm text-neutral-300">{f.label}</span>
                  <Switch
                    checked={settings?.[f.key] === true}
                    onCheckedChange={(v) => setSettings({ ...settings, [f.key]: v })}
                  />
                </div>
              ))}
            </div>
            <Button onClick={() => saveSettings()} disabled={saving} className="mt-5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Kaydet
            </Button>
          </div>
        </TabsContent>

        {/* ============ QUIZLER ============ */}
        <TabsContent value="quizzes" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-400">
              Şık başına buton harfle (A/B/C) gider; doğru cevabı yuvarlağa tıklayarak işaretle.
            </p>
            <Button
              variant="outline"
              onClick={() =>
                setQuizzes([...quizzes, { _new: true, question: "", options: ["", ""], correct_index: 0, active: true }])
              }
            >
              <Plus className="w-4 h-4 mr-1" /> Yeni Soru
            </Button>
          </div>
          {quizzes.map((q, qi) => (
            <QuizEditor
              key={q.id || `new-${qi}`}
              quiz={q}
              userId={userId}
              onChange={(nq) => setQuizzes(quizzes.map((x, i) => (i === qi ? nq : x)))}
              onDelete={() => setQuizzes(quizzes.filter((_x, i) => i !== qi))}
            />
          ))}
        </TabsContent>

        {/* ============ ODULLER ============ */}
        <TabsContent value="rewards" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-400">Takipçiler "ÖDÜLLER" yazınca bu katalog gider.</p>
            <Button
              variant="outline"
              onClick={() =>
                setRewards([...rewards, { _new: true, title: "", cost: 50, stock: "", fixed_code: "", min_follow: true, active: true }])
              }
            >
              <Plus className="w-4 h-4 mr-1" /> Yeni Ödül
            </Button>
          </div>
          {rewards.map((r, ri) => (
            <RewardEditor
              key={r.id || `new-${ri}`}
              reward={r}
              userId={userId}
              onChange={(nr) => setRewards(rewards.map((x, i) => (i === ri ? nr : x)))}
              onDelete={() => setRewards(rewards.filter((_x, i) => i !== ri))}
            />
          ))}
        </TabsContent>

      </Tabs>
      {/* AI Yönetici artık kendi sayfasında: /dashboard/chatbot */}
    </div>
  )
}

// ============ QUIZ EDITORU ============
function QuizEditor({ quiz, userId, onChange, onDelete }: any) {
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const method = quiz._new ? "POST" : "PUT"
      const res = await fetch("/api/gamification/quizzes", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, id: quiz.id, ...quiz }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Hata")
      onChange({ ...data })
      toast.success("Soru kaydedildi ✅")
    } catch (e: any) {
      toast.error(e.message || "Kaydedilemedi")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (quiz._new) return onDelete()
    if (!confirm("Bu soru silinsin mi? (verilen cevap kayıtları da silinir)")) return
    setBusy(true)
    try {
      const res = await fetch(`/api/gamification/quizzes?userId=${userId}&id=${quiz.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      onDelete()
      toast.success("Soru silindi")
    } catch {
      toast.error("Silinemedi")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <Textarea
          className={`${inputCls} min-h-[60px]`}
          placeholder="Soru metni…"
          value={quiz.question}
          onChange={(e) => onChange({ ...quiz, question: e.target.value })}
        />
        <div className="flex flex-col items-center gap-1 pt-1">
          <Switch checked={quiz.active !== false} onCheckedChange={(v) => onChange({ ...quiz, active: v })} />
          <span className="text-[10px] text-neutral-500">{quiz.active !== false ? "Aktif" : "Pasif"}</span>
        </div>
      </div>
      <div className="space-y-2">
        {quiz.options.map((opt: string, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              title="Doğru cevap olarak işaretle"
              onClick={() => onChange({ ...quiz, correct_index: i })}
              className={`w-5 h-5 rounded-full border-2 shrink-0 transition-colors ${
                quiz.correct_index === i ? "bg-green-500 border-green-400" : "border-neutral-600 hover:border-green-400"
              }`}
            />
            <span className="w-5 text-xs text-neutral-500 font-mono">{String.fromCharCode(65 + i)})</span>
            <Input
              className={inputCls}
              value={opt}
              placeholder={`Şık ${i + 1}`}
              onChange={(e) =>
                onChange({ ...quiz, options: quiz.options.map((o: string, oi: number) => (oi === i ? e.target.value : o)) })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={quiz.options.length <= 2}
              onClick={() => {
                const opts = quiz.options.filter((_o: string, oi: number) => oi !== i)
                let ci = quiz.correct_index
                if (ci === i) ci = 0
                else if (ci > i) ci -= 1
                onChange({ ...quiz, options: opts, correct_index: ci })
              }}
            >
              <Trash2 className="w-4 h-4 text-neutral-500" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={quiz.options.length >= 13}
          onClick={() => onChange({ ...quiz, options: [...quiz.options, ""] })}
        >
          <Plus className="w-4 h-4 mr-1" /> Şık ekle
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Kaydet
        </Button>
        <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-[11px] text-neutral-500 mt-2">
        ✅ Doğru cevap: {quiz.options[quiz.correct_index] ? `${String.fromCharCode(65 + quiz.correct_index)}) ${quiz.options[quiz.correct_index]}` : "işaretlenmedi"}
      </p>
    </div>
  )
}

// ============ ODUL EDITORU ============
function RewardEditor({ reward, userId, onChange, onDelete }: any) {
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const method = reward._new ? "POST" : "PUT"
      const res = await fetch("/api/gamification/rewards", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, id: reward.id, ...reward }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Hata")
      onChange({ ...data })
      toast.success("Ödül kaydedildi ✅")
    } catch (e: any) {
      toast.error(e.message || "Kaydedilemedi")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (reward._new) return onDelete()
    if (!confirm("Bu ödül silinsin mi?")) return
    setBusy(true)
    try {
      const res = await fetch(`/api/gamification/rewards?userId=${userId}&id=${reward.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error()
      onDelete()
      toast.success(data.deactivated ? "Takas geçmişi olduğu için pasife alındı" : "Ödül silindi")
    } catch {
      toast.error("Silinemedi")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cardCls}>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr] gap-3">
        <div>
          <label className={labelCls}>Başlık</label>
          <Input className={inputCls} value={reward.title} onChange={(e) => onChange({ ...reward, title: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Puan bedeli</label>
          <Input type="number" className={inputCls} value={reward.cost} onChange={(e) => onChange({ ...reward, cost: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Stok (boş = sınırsız)</label>
          <Input type="number" className={inputCls} value={reward.stock ?? ""} onChange={(e) => onChange({ ...reward, stock: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Kod (DM ile teslim)</label>
          <Input className={inputCls} value={reward.fixed_code ?? ""} onChange={(e) => onChange({ ...reward, fixed_code: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3">
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <Switch checked={reward.min_follow !== false} onCheckedChange={(v) => onChange({ ...reward, min_follow: v })} /> Takipçi şartı
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <Switch checked={reward.active !== false} onCheckedChange={(v) => onChange({ ...reward, active: v })} /> Aktif
        </label>
        <div className="flex-1" />
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Kaydet
        </Button>
        <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
