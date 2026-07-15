"use client"

import { Button } from "@/components/ui/button"
import { Zap, MessageCircle, Shield, Clock } from "lucide-react"

// Tek OAuth URL kaynagi — AccountSwitcher "Yeni hesap bagla" da bunu kullanir
export function instagramOAuthUrl() {
  return `https://www.instagram.com/oauth/authorize?force_reauth=true&client_id=${process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID}&redirect_uri=${process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI}&response_type=code&scope=instagram_business_basic%2Cinstagram_business_manage_messages%2Cinstagram_business_manage_comments%2Cinstagram_business_content_publish%2Cinstagram_business_manage_insights`
}

export function LandingPage() {
  const handleLogin = () => {
    window.location.href = instagramOAuthUrl()
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black overflow-hidden">
      {/* Subtle bg glow */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-white/[0.03] rounded-full blur-[120px]" />
      </div>

      <nav className="relative z-50 h-20 flex items-center justify-between px-6 md:px-12 border-b border-white/5">
        <div className="flex items-center">
          <img src="/fabrika-logo.png" alt="Fabrika Müzik" className="h-12 w-auto" />
        </div>
        <Button
          onClick={handleLogin}
          variant="outline"
          className="border-white/20 rounded-full px-6 text-xs font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-all bg-transparent"
        >
          Giriş
        </Button>
      </nav>

      <main className="relative z-10 pt-20 md:pt-32 px-6 md:px-12 pb-24">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-xs text-neutral-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Collective Üyelerine Özel
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
            Sen Müziğini Yap.
            <br />
            <span className="text-neutral-500">Cevapları Biz Veririz.</span>
          </h1>

          <img
            src="/fabrika-collective.png"
            alt="Fabrika Müzik — New Generation Music Collective"
            className="h-10 md:h-12 w-auto mx-auto opacity-90"
          />

          <p className="text-lg text-neutral-500 max-w-lg mx-auto leading-relaxed">
            Yorumlara ve DM'lere anahtar kelime tetikleyicileri kur.
            Cevapları <strong className="text-white">Fabrika Müzik</strong> otomasyonu halletsin —
            sen müziğine odaklan.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={handleLogin}
              className="bg-white text-black h-14 px-10 rounded-full font-bold text-sm hover:scale-105 transition-transform shadow-lg shadow-white/10"
            >
              Instagram'ı Bağla
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="max-w-4xl mx-auto mt-24 grid md:grid-cols-3 gap-4">
          <FeatureCard
            icon={<MessageCircle className="w-5 h-5" />}
            title="Yorum & DM Cevapları"
            description="Yorumlardaki ve mesajlardaki anahtar kelimelere anında otomatik cevap."
          />
          <FeatureCard
            icon={<Shield className="w-5 h-5" />}
            title="Takip Kapısı"
            description="Linkler sadece takipçilere gitsin — topluluğunu akıllıca büyüt."
          />
          <FeatureCard
            icon={<Clock className="w-5 h-5" />}
            title="7/24 Açık"
            description="Sen sahnedeyken de çalışır. Hiçbir fırsat kaçmaz."
          />
        </div>
      </main>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-6 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all group">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-neutral-400 group-hover:text-white group-hover:bg-white/10 transition-all mb-4">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-white mb-1">{title}</h3>
      <p className="text-xs text-neutral-500 leading-relaxed">{description}</p>
    </div>
  )
}
