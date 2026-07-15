"use client"

import { useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { LandingPage } from "@/components/layout/landing-page"
import { Loader2 } from "lucide-react"

export default function Home() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Check if we have an active session or a callback code
    const code = searchParams.get("code")
    const savedId = localStorage.getItem("ig_user_id")
    // ?connect=1 → oturum olsa da landing goster (yeni hesap baglama kacis kapisi)
    const wantsConnect = searchParams.get("connect") === "1"

    if (!wantsConnect && (code || savedId)) {
      // If code exists, Redirect to dashboard to handle the handshake (via the new hook)
      // If local session exists, also redirect
      router.replace("/dashboard?code=" + (code || ""))
    }
  }, [searchParams, router])

  return <LandingPage />
}
