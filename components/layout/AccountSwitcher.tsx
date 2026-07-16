/* @ts-nocheck */
"use client"

// ============================================================
// HESAP DEGISTIRICI (Postiz tarzi)
// Bagli tum hesaplar listeden secilir — cikis/giris OAuth'suz.
// Secim localStorage'a yazilir + sayfa yenilenir (tum paneller yeni hesabi okur).
// Yeni hesap baglamak icin tek OAuth: "Yeni hesap bagla".
// ============================================================

import { useEffect, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronsUpDown, Plus, Check, AlertTriangle, Instagram } from "lucide-react"
import { instagramOAuthUrl } from "@/components/layout/landing-page"

interface Account {
  id: string
  username: string
  healthy: boolean
}

export function AccountSwitcher() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string>("Hesap seç")

  useEffect(() => {
    setActiveId(localStorage.getItem("ig_user_id"))
    setActiveName(localStorage.getItem("ig_username") || "Hesap seç")
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (!Array.isArray(list)) return
        setAccounts(list)
        // secili hesap bu kullaniciya ait degilse (veya hic secim yoksa)
        // ilk kendi hesabina gec — yoksa paneller 403 alir ve bos gorunur
        const stored = localStorage.getItem("ig_user_id")
        if (list.length && !list.some((a: Account) => a.id === stored)) {
          localStorage.setItem("ig_user_id", list[0].id)
          localStorage.setItem("ig_username", list[0].username)
          window.location.reload()
        }
      })
      .catch(() => {})
  }, [])

  const switchTo = (acc: Account) => {
    if (acc.id === activeId) return
    localStorage.setItem("ig_user_id", acc.id)
    localStorage.setItem("ig_username", acc.username)
    // tam yenileme: tum sayfalar/state yeni hesabi temiz okur
    window.location.reload()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-left">
          <div className="w-9 h-9 rounded-full bg-neutral-800 ring-2 ring-white/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-neutral-300">
              {(activeName || "?").charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-xs font-bold text-white truncate">{activeName}</p>
            <p className="text-[10px] text-neutral-500">Hesap değiştir</p>
          </div>
          <ChevronsUpDown className="w-4 h-4 text-neutral-500 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60 bg-neutral-900 border-white/10 text-white">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-neutral-500">
          Bağlı Hesaplar ({accounts.length})
        </DropdownMenuLabel>
        {accounts.map((acc) => (
          <DropdownMenuItem
            key={acc.id}
            onClick={() => switchTo(acc)}
            className="flex items-center gap-2 cursor-pointer focus:bg-white/10 focus:text-white"
          >
            <Instagram className="w-3.5 h-3.5 text-neutral-500" />
            <span className="flex-1 truncate text-sm">@{acc.username}</span>
            {!acc.healthy && (
              <span title="Token sorunlu — yeniden bağlanmalı">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              </span>
            )}
            {acc.id === activeId && <Check className="w-3.5 h-3.5 text-emerald-400" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          // FIX: eskiden "/"a gidiyordu; ana sayfa localStorage'daki oturumu gorup
          // /dashboard'a GERI atiyordu — OAuth hic acilmiyordu (sonsuz dongu).
          // Artik dogrudan Instagram yetkilendirmesine gider.
          onClick={() => (window.location.href = instagramOAuthUrl())}
          className="flex items-center gap-2 cursor-pointer text-neutral-300 focus:bg-white/10 focus:text-white"
        >
          <Plus className="w-3.5 h-3.5" /> Yeni hesap bağla
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
