"use client"

import type React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Instagram, LayoutDashboard, Zap, LogOut, Settings, BarChart3, MessageSquare, Snowflake, Clapperboard, Trophy, Bot, SlidersHorizontal, UserCheck } from "lucide-react"
import { AccountSwitcher } from "@/components/layout/AccountSwitcher"
import Link from "next/link"
import { usePathname } from "next/navigation"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  username?: string
  className?: string
  onLogout?: () => void
  onNavigate?: () => void
}

export function Sidebar({ className, username = "Demo User", onLogout, onNavigate, ...props }: SidebarProps) {
  const pathname = usePathname()

  const isActive = (path: string) => pathname === path

  return (
    <aside className={cn("flex flex-col", className)} {...props}>
      <div className="p-6 flex flex-col items-start gap-2">
        <img src="/fabrika-logo.png" alt="Fabrika Müzik" className="h-14 w-auto object-contain" />
        <span className="text-[9px] uppercase font-bold text-neutral-500 tracking-widest">New Generation Collective</span>
      </div>

      <div className="flex-1 px-4 space-y-2 py-4">
        <div className="px-2 mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">Main</div>
        <NavItem
          href="/dashboard"
          icon={<LayoutDashboard className="w-4 h-4" />}
          label="Dashboard"
          active={isActive("/dashboard")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/automations"
          icon={<Zap className="w-4 h-4" />}
          label="Automations"
          active={isActive("/dashboard/automations")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/publisher"
          icon={<Clapperboard className="w-4 h-4" />}
          label="Publisher"
          active={isActive("/dashboard/publisher")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/ice-breakers"
          icon={<Snowflake className="w-4 h-4" />}
          label="Ice Breakers"
          active={isActive("/dashboard/ice-breakers")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/inbox"
          icon={<MessageSquare className="w-4 h-4" />}
          label="Inbox"
          active={isActive("/dashboard/inbox")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/gamification"
          icon={<Trophy className="w-4 h-4" />}
          label="Oyunlaştırma"
          active={isActive("/dashboard/gamification")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/chatbot"
          icon={<Bot className="w-4 h-4" />}
          label="Chatbot"
          active={isActive("/dashboard/chatbot")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/customization"
          icon={<SlidersHorizontal className="w-4 h-4" />}
          label="Özelleştirme"
          active={isActive("/dashboard/customization")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/followers"
          icon={<UserCheck className="w-4 h-4" />}
          label="Takip Durumu"
          active={isActive("/dashboard/followers")}
          onClick={onNavigate}
        />
        <NavItem
          href="/dashboard/analytics"
          icon={<BarChart3 className="w-4 h-4" />}
          label="Analytics"
          active={isActive("/dashboard/analytics")}
          onClick={onNavigate}
        />

        <div className="px-2 mb-2 mt-6 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
          System
        </div>
        <NavItem
          href="/dashboard/settings"
          icon={<Settings className="w-4 h-4" />}
          label="Settings"
          active={isActive("/dashboard/settings")}
          onClick={onNavigate}
        />
      </div>

      <div className="p-4 border-t border-white/10">
        {/* Postiz tarzi hesap degistirici: cikis/giris olmadan listeden sec */}
        <AccountSwitcher />
      </div>
    </aside>
  )
}

function NavItem({
  icon,
  label,
  active = false,
  href,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  href: string
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all font-medium text-[13px] group relative overflow-hidden ${active ? "bg-white text-black shadow-none" : "text-neutral-500 hover:text-white hover:bg-white/5"
        }`}
    >
      {active && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] animate-shimmer" />
      )}
      <span className={active ? "text-black" : "group-hover:text-white transition-colors duration-300"}>{icon}</span>
      <span>{label}</span>
    </Link>
  )
}
