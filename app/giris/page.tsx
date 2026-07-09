/* @ts-nocheck */
"use client"

// Panel giris sayfasi (ADMIN_PASSWORD korumasi icin) — /giris

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, Lock } from "lucide-react"

export default function GirisPage() {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  const submit = async (e: any) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (res.ok) router.push("/dashboard")
      else setError("Şifre hatalı")
    } catch {
      setError("Bağlantı hatası")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col items-center gap-4">
        <Image src="/fabrika-logo.png" alt="Fabrika Müzik" width={64} height={64} className="rounded-xl" />
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Lock className="w-4 h-4" /> Panel Girişi
        </h1>
        <Input
          type="password"
          placeholder="Yönetici şifresi"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="bg-black/40 border-white/10 text-white"
          autoFocus
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={busy || !password} className="w-full">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Giriş Yap"}
        </Button>
        <p className="text-[11px] text-neutral-500 text-center">
          Şifre, Vercel ortam değişkeni <code className="font-mono">ADMIN_PASSWORD</code>'dur.
        </p>
      </form>
    </main>
  )
}
