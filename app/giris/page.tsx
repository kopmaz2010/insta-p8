/* @ts-nocheck */
"use client"

// Cok kullanicili giris — /giris
// 1) Erisim kodu ile gir. 2) Ilk giriste yeni kod belirleme zorunlu
// (kodu veren kisi artik bilmesin diye). Kod = kisisel sifre.

import { useState } from "react"
import Image from "next/image"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, Lock, KeyRound } from "lucide-react"

export default function GirisPage() {
  const [code, setCode] = useState("")
  const [newCode, setNewCode] = useState("")
  const [newCode2, setNewCode2] = useState("")
  const [step, setStep] = useState<"login" | "change">("login")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const goNext = () => {
    const next = new URLSearchParams(window.location.search).get("next")
    const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"
    window.location.href = safe
  }

  const submitLogin = async (e: any) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const d = await res.json()
      if (res.ok) {
        setName(d.name || "")
        if (d.mustChange) setStep("change")
        else goNext()
      } else setError(d.error || "Kod hatalı")
    } catch {
      setError("Bağlantı hatası")
    } finally {
      setBusy(false)
    }
  }

  const submitChange = async (e: any) => {
    e.preventDefault()
    if (newCode !== newCode2) {
      setError("Kodlar aynı değil")
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/auth/change-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCode }),
      })
      const d = await res.json()
      if (res.ok) goNext()
      else setError(d.error || "Kaydedilemedi")
    } catch {
      setError("Bağlantı hatası")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      {step === "login" ? (
        <form onSubmit={submitLogin} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col items-center gap-4">
          <Image src="/fabrika-logo.png" alt="Fabrika Müzik" width={64} height={64} className="rounded-xl" />
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Lock className="w-4 h-4" /> Panel Girişi
          </h1>
          <Input
            type="password"
            placeholder="Erişim kodunuz"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="bg-black/40 border-white/10 text-white"
            autoFocus
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={busy || !code} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Giriş Yap"}
          </Button>
          <p className="text-[11px] text-neutral-500 text-center">
            Kodunuz yoksa yöneticiden isteyin. Kod size özeldir, kimseyle paylaşmayın.
          </p>
        </form>
      ) : (
        <form onSubmit={submitChange} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col items-center gap-4">
          <Image src="/fabrika-logo.png" alt="Fabrika Müzik" width={64} height={64} className="rounded-xl" />
          <h1 className="text-lg font-bold flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Hoş geldin{name ? `, ${name}` : ""}
          </h1>
          <p className="text-xs text-neutral-400 text-center">
            İlk girişiniz: kendinize yeni bir erişim kodu belirleyin. Bundan sonra bu kodla gireceksiniz.
          </p>
          <Input
            type="password"
            placeholder="Yeni kod (en az 6 karakter)"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            className="bg-black/40 border-white/10 text-white"
            autoFocus
          />
          <Input
            type="password"
            placeholder="Yeni kod (tekrar)"
            value={newCode2}
            onChange={(e) => setNewCode2(e.target.value)}
            className="bg-black/40 border-white/10 text-white"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={busy || newCode.length < 6 || !newCode2} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Kodu Kaydet ve Devam Et"}
          </Button>
        </form>
      )}
    </main>
  )
}
