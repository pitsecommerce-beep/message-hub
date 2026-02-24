import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  ShoppingBag,
  Database,
  Bot,
  Puzzle,
  UserCog,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { toast } from 'sonner'
import { auth } from '@/lib/firebase'
import { useAppStore } from '@/store/app.store'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Panel Principal' },
  { to: '/conversations', icon: MessageSquare, label: 'Conversaciones' },
  { to: '/contacts', icon: Users, label: 'Contactos' },
  { to: '/orders', icon: ShoppingBag, label: 'Pedidos' },
] as const

const CONFIG_ITEMS: Array<{
  to: string
  icon: React.ComponentType<{ size?: number }>
  label: string
  restricted?: boolean
}> = [
  { to: '/knowledge-base', icon: Database, label: 'Bases de Datos' },
  { to: '/agents', icon: Bot, label: 'Agentes IA', restricted: true },
  { to: '/integrations', icon: Puzzle, label: 'Integraciones', restricted: true },
  { to: '/team', icon: UserCog, label: 'Equipo' },
  { to: '/settings', icon: Settings, label: 'Configuración' },
]

interface SidebarProps {
  className?: string
}

export default function Sidebar({ className }: SidebarProps) {
  const { userData, organization, sidebarOpen, setSidebarOpen } = useAppStore()
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await signOut(auth)
      navigate('/login')
    } catch {
      toast.error('Error al cerrar sesión')
    }
  }

  const isAgent = userData?.role === 'agent' || userData?.role === 'agente' as string

  const avatarLetter = userData?.name?.charAt(0)?.toUpperCase() ?? 'U'
  const orgName = organization?.brandName ?? organization?.name ?? 'MessageHub'

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-full w-60 flex-col bg-gray-900/95 backdrop-blur border-r border-white/8 transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
          className,
        )}
      >
        {/* Logo / Brand */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-white/8">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
              <MessageSquare size={14} className="text-white" />
            </div>
            <span className="font-semibold text-sm text-white truncate">{orgName}</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 rounded text-gray-400 hover:text-white hover:bg-white/8"
          >
            <X size={16} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-brand-600/20 text-brand-300 font-medium'
                    : 'text-gray-400 hover:bg-white/8 hover:text-white',
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          <div className="px-3 pt-4 pb-1">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Configuración
            </span>
          </div>

          {CONFIG_ITEMS.map(({ to, icon: Icon, label, restricted }) => {
            if (restricted && isAgent) return null
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                    isActive
                      ? 'bg-brand-600/20 text-brand-300 font-medium'
                      : 'text-gray-400 hover:bg-white/8 hover:text-white',
                  )
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-white/8 p-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-brand-600 flex items-center justify-center shrink-0 text-sm font-semibold text-white">
              {avatarLetter}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{userData?.name ?? ''}</p>
              <p className="text-xs text-gray-500 truncate capitalize">{userData?.role ?? ''}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

export function SidebarToggle() {
  const { toggleSidebar } = useAppStore()
  return (
    <button
      onClick={toggleSidebar}
      className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/8 transition-colors lg:hidden"
    >
      <Menu size={18} />
    </button>
  )
}
