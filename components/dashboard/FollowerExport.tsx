/* @ts-nocheck */
"use client"

// ============================================================
// TAM TAKIPCI ANALIZI — Instagram "Bilgilerini Indir" (DYI) export'undan
// Kullanici IG'den ZIP indirir, buraya yukler. ZIP TARAYICIDA acilir
// (JSZip), followers_*.json + following.json parse edilir. Dosya sunucuya
// GITMEZ — tam gizlilik. Meta Basic Display API 2024'te kapandi; resmi
// tek yol bu export.
// ============================================================

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, UserX, Heart, Users, Download, ExternalLink } from "lucide-react"

type Person = { username: string; href: string }

function extractUsernames(json: any, key?: string): Person[] {
  // followers_1.json = top-level array; following.json = { relationships_following: [...] }
  const arr = Array.isArray(json) ? json : json?.[key || "relationships_following"] || []
  const out: Person[] = []
  for (const item of arr) {
    const d = item?.string_list_data?.[0]
    if (d?.value) out.push({ username: d.value, href: d.href || `https://instagram.com/${d.value}` })
  }
  return out
}

export function FollowerExport() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<any>(null)
  const [tab, setTab] = useState<"notback" | "fans" | "all">("notback")

  const onFile = async (file: File) => {
    if (!file) return
    setBusy(true)
    setError("")
    setResult(null)
    try {
      const JSZip = (await import("jszip")).default
      const zip = await JSZip.loadAsync(file)

      const followerFiles: string[] = []
      let followingFile = ""
      zip.forEach((path) => {
        const p = path.toLowerCase()
        if (p.includes("followers") && p.endsWith(".json")) followerFiles.push(path)
        if (p.includes("following") && p.endsWith(".json") && !p.includes("pending")) followingFile = path
      })

      if (followerFiles.length === 0 && !followingFile) {
        throw new Error(
          "ZIP içinde followers/following bulunamadı. İndirirken FORMAT = JSON seçtiğinden emin ol (HTML değil).",
        )
      }

      let followers: Person[] = []
      for (const f of followerFiles) {
        const j = JSON.parse(await zip.file(f).async("string"))
        followers = followers.concat(extractUsernames(j))
      }
      let following: Person[] = []
      if (followingFile) {
        const j = JSON.parse(await zip.file(followingFile).async("string"))
        following = extractUsernames(j, "relationships_following")
      }

      const followerSet = new Set(followers.map((p) => p.username.toLowerCase()))
      const followingSet = new Set(following.map((p) => p.username.toLowerCase()))
      // ben takip ediyorum, beni takip ETMIYOR (temizlenebilir)
      const notBack = following.filter((p) => !followerSet.has(p.username.toLowerCase()))
      // beni takip ediyor, ben ETMIYORUM (hayran)
      const fans = followers.filter((p) => !followingSet.has(p.username.toLowerCase()))

      setResult({
        followers: followers.length,
        following: following.length,
        notBack,
        fans,
        all: followers,
      })
    } catch (e: any) {
      setError(e.message || "Dosya okunamadı")
    } finally {
      setBusy(false)
    }
  }

  const list = result ? (tab === "notback" ? result.notBack : tab === "fans" ? result.fans : result.all) : []

  return (
    <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Download className="w-4 h-4 text-emerald-400" />
        <h2 className="font-semibold text-white">Tam Takipçi Analizi (Instagram Export)</h2>
      </div>
      <p className="text-xs text-neutral-400 mb-3">
        <strong>Tüm</strong> takipçilerini görmek için Instagram'ın resmi verini kullan. Dosya bu tarayıcıda işlenir,
        hiçbir yere gönderilmez.
      </p>

      <details className="mb-4 text-xs text-neutral-400">
        <summary className="cursor-pointer text-neutral-300 font-medium">📥 Veriyi nasıl indiririm? (tıkla)</summary>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>Instagram → Ayarlar → <strong>Hesap Merkezi</strong></li>
          <li>Bilgilerin ve izinlerin → <strong>Bilgilerini indir</strong></li>
          <li>Hesabı seç → <strong>Bilgilerinin bir kısmını indir</strong> → yalnızca <strong>"Takipçiler ve takip edilenler"</strong></li>
          <li>Biçim: <strong className="text-amber-300">JSON</strong> (HTML DEĞİL) · Tarih aralığı: Tüm zamanlar</li>
          <li>İndirme hazır olunca (dakikalar) ZIP'i indir, aşağıya yükle</li>
        </ol>
        <a
          href="https://accountscenter.instagram.com/info_and_permissions/dyi/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-orange-400 hover:underline"
        >
          İndirme sayfasını aç <ExternalLink className="w-3 h-3" />
        </a>
      </details>

      <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/30 py-6 cursor-pointer hover:border-white/40 transition">
        {busy ? <Loader2 className="w-5 h-5 animate-spin text-neutral-400" /> : <Upload className="w-5 h-5 text-neutral-400" />}
        <span className="text-sm text-neutral-300">{busy ? "İşleniyor..." : "ZIP dosyasını seç veya sürükle"}</span>
        <input
          type="file"
          accept=".zip"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

      {result && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ExpStat label="Takipçi" value={result.followers} color="text-white" icon={<Users className="w-4 h-4" />} />
            <ExpStat label="Takip edilen" value={result.following} color="text-neutral-300" icon={<Users className="w-4 h-4" />} />
            <ExpStat label="Geri takip etmiyor" value={result.notBack.length} color="text-red-400" icon={<UserX className="w-4 h-4" />} />
            <ExpStat label="Hayran (ben etmiyorum)" value={result.fans.length} color="text-pink-400" icon={<Heart className="w-4 h-4" />} />
          </div>

          <div className="flex gap-2 text-xs">
            <TabBtn active={tab === "notback"} onClick={() => setTab("notback")}>Geri takip etmeyenler ({result.notBack.length})</TabBtn>
            <TabBtn active={tab === "fans"} onClick={() => setTab("fans")}>Hayranlar ({result.fans.length})</TabBtn>
            <TabBtn active={tab === "all"} onClick={() => setTab("all")}>Tüm takipçiler ({result.followers})</TabBtn>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 divide-y divide-white/5 max-h-[420px] overflow-auto">
            {list.length === 0 && <div className="p-6 text-center text-sm text-neutral-500">Liste boş.</div>}
            {list.map((p: Person) => (
              <a key={p.username} href={p.href} target="_blank" rel="noreferrer" className="flex items-center px-4 py-2.5 hover:bg-white/5">
                <span className="text-sm text-white truncate">@{p.username}</span>
                <ExternalLink className="w-3 h-3 text-neutral-600 ml-auto" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ExpStat({ label, value, color, icon }: any) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className={`flex items-center gap-1.5 ${color}`}>{icon}<span className="text-2xl font-bold">{value}</span></div>
      <p className="text-[11px] text-neutral-500 mt-1">{label}</p>
    </div>
  )
}

function TabBtn({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border transition ${
        active ? "bg-white text-black border-white" : "border-white/10 text-neutral-400 hover:text-white hover:border-white/20"
      }`}
    >
      {children}
    </button>
  )
}
