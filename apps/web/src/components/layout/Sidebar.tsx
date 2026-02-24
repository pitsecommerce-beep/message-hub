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
  icon: React.ComponentType<{ size?: number; className?: string }>
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
          'fixed left-0 top-0 z-40 flex h-full w-60 flex-col border-r border-white/[0.06] transition-transform duration-200',
          'bg-[#0c0c18]/95 backdrop-blur-xl',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
          className,
        )}
      >
        {/* Logo / Brand */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center shrink-0 shadow-md shadow-brand-900/50">
              <MessageSquare size={13} className="text-white" />
            </div>
            <span className="font-semibold text-sm text-white/90 truncate tracking-tight">{orgName}</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.07] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150',
                  isActive
                    ? 'bg-brand-500/15 text-brand-300 font-medium shadow-sm'
                    : 'text-gray-500 hover:bg-white/[0.06] hover:text-gray-200',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} className={isActive ? 'text-brand-400' : ''} />
                  {label}
                </>
              )}
            </NavLink>
          ))}

          <div className="px-3 pt-5 pb-1.5">
            <span className="text-[10px] font-semibold text-gray-700 uppercase tracking-widest">
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
                    'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150',
                    isActive
                      ? 'bg-brand-500/15 text-brand-300 font-medium shadow-sm'
                      : 'text-gray-500 hover:bg-white/[0.06] hover:text-gray-200',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={15} className={isActive ? 'text-brand-400' : ''} />
                    {label}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-2.5 px-1">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-brand-400 to-violet-600 flex items-center justify-center shrink-0 text-xs font-bold text-white shadow-sm">
              {avatarLetter}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white/90 truncate leading-tight">{userData?.name ?? ''}</p>
              <p className="text-xs text-gray-600 truncate capitalize leading-tight mt-0.5">{userData?.role ?? ''}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
