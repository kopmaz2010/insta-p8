"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { Loader2 } from "lucide-react"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { username, logout, isLoading } = useInstagramSession()
    const [authChecked, setAuthChecked] = useState(false)

    // ADMIN_PASSWORD korumasi aktifse ve oturum yoksa /giris'e yonlendir —
    // yoksa API'ler sessizce 401 doner ve paneller bos gorunur ("bozuldu" hissi)
    useEffect(() => {
        fetch("/api/auth/login")
            .then((r) => r.json())
            .then((d) => {
                if (d.protected && !d.authenticated) {
                    // OAuth donusundeki ?code=... kaybolmasin: giristen sonra
                    // ayni URL'e (query dahil) geri donulur
                    const next = encodeURIComponent(window.location.pathname + window.location.search)
                    window.location.href = `/giris?next=${next}`
                } else setAuthChecked(true)
            })
            .catch(() => setAuthChecked(true)) // kontrol edilemezse paneli engelleme
    }, [])

    if (!authChecked) {
        return (
            <div className="flex h-screen items-center justify-center bg-black text-white">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-black text-white">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
        )
    }

    return (
        <div className="flex min-h-screen bg-black text-foreground">
            {/* Desktop Sidebar */}
            <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 z-50">
                <Sidebar
                    className="h-full border-r border-white/10 bg-black/50 backdrop-blur-xl"
                    username={username || "User"}
                    onLogout={logout}
                />
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col md:pl-64 transition-all duration-300">
                {/* Mobile Header (Visible only on small screens) */}
                <header className="md:hidden h-16 border-b border-white/10 bg-black flex items-center justify-between px-4 sticky top-0 z-40">
                    <img src="/fabrika-logo.png" alt="Fabrika Müzik" className="h-9 w-auto" />
                    <MobileNav username={username || "User"} onLogout={logout} />
                </header>

                <main className="flex-1 relative overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
