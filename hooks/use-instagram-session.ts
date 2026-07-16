"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"

// Ayni OAuth code'unu iki kez POST etmeyi engeller (yenileme / cift render):
// code tek kullanimlik oldugu icin ikinci istek "already used" hatasi uretiyordu
const processedCodes = new Set<string>()

export function useInstagramSession() {
    const [username, setUsername] = useState<string | null>(null)
    const [userId, setUserId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const searchParams = useSearchParams()
    const router = useRouter()

    useEffect(() => {
        const code = searchParams.get("code")

        const handleSession = async () => {
            // CASE A: New Login from Instagram
            if (code && !processedCodes.has(code)) {
                processedCodes.add(code)
                try {
                    const res = await fetch("/api/instagram/callback", {
                        method: "POST",
                        body: JSON.stringify({ code }),
                    })
                    const data = await res.json()

                    if (data.success) {
                        localStorage.setItem("ig_user_id", data.userId)
                        localStorage.setItem("ig_username", data.username)

                        setUserId(data.userId)
                        setUsername(data.username)
                        // Remove code from URL
                        router.replace("/dashboard")
                    } else {
                        // FIX (9 Tem): baglanti hatasi SESSIZCE yutuluyordu — kullanici
                        // nedenini hic goremiyordu. Artik ekranda gosterilir.
                        console.error("Login failed:", data.error)
                        toast.error("Instagram bağlantısı tamamlanamadı", {
                            description: data.error || "Lütfen 'Instagram'ı Bağla' ile tekrar dene.",
                            duration: 12000,
                        })
                        router.replace("/dashboard")
                    }
                } catch (err) {
                    console.error("Login failed:", err)
                    toast.error("Ağ hatası — Instagram bağlantısı tamamlanamadı", {
                        description: "İnternetini kontrol edip tekrar dene.",
                        duration: 12000,
                    })
                }
            }
            // CASE B: Restore Session from LocalStorage
            else {
                const savedId = localStorage.getItem("ig_user_id")
                const savedName = localStorage.getItem("ig_username")

                if (savedId && savedName) {
                    setUserId(savedId)
                    setUsername(savedName)
                }
            }
            setIsLoading(false)
        }

        handleSession()
    }, [searchParams, router])

    const logout = () => {
        localStorage.removeItem("ig_user_id")
        localStorage.removeItem("ig_username")
        document.cookie = "insta_session=; Max-Age=0; path=/;"
        // panel oturumunu da kapat (ia_sess httpOnly — sunucudan silinir)
        fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
        setUsername(null)
        setUserId(null)
        router.push("/giris")
    }

    return { userId, username, isLoading, logout }
}
