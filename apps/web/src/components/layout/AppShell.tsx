import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import Sidebar, { SidebarToggle } from './Sidebar'

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'Panel Principal', subtitle: 'Resumen de tu actividad de mensajería' },
  '/conversations': { title: 'Conversaciones', subtitle: 'Gestiona todas tus conversaciones y funnel de ventas' },
  '/contacts': { title: 'Contactos', subtitle: 'Directorio de contactos enriquecido' },
  '/orders': { title: 'Pedidos', subtitle: 'Pedidos generados desde las conversaciones' },
  '/knowledge-base': { title: 'Bases de Datos', subtitle: 'Gestiona el conocimiento de tus agentes IA' },
  '/agents': { title: 'Agentes IA', subtitle: 'Configura agentes de inteligencia artificial' },
  '/integrations': { title: 'Integraciones', subtitle: 'Conecta plataformas de mensajería y pasarelas de pago' },
  '/team': { title: 'Equipo', subtitle: 'Gestiona los miembros de tu equipo' },
  '/settings': { title: 'Configuración', subtitle: 'Preferencias de la organización' },
}

export default function AppShell() {
  const location = useLocation()
  const pageInfo = PAGE_TITLES[location.pathname] ?? { title: 'MessageHub', subtitle: '' }
  const mainRef = useRef<HTMLElement>(null)

  // Trigger page transition on route change
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    el.classList.remove('page-enter')
    // Force reflow so the class removal is recognized before re-adding
    void el.offsetHeight
    el.classList.add('page-enter')
  }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-surface-0)' }}>
      <Sidebar />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden lg:pl-60">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.05] px-4 lg:px-6 backdrop-blur-md bg-black/20">
          <div className="flex items-center gap-3">
            <SidebarToggle />
            <div>
              <h1 className="text-base font-semibold text-white/90 leading-none tracking-tight">
                {pageInfo.title}
              </h1>
              {pageInfo.subtitle && (
                <p className="text-xs text-gray-500 mt-0.5 leading-none">{pageInfo.subtitle}</p>
              )}
            </div>
          </div>
        </header>

        {/* Page content with transition */}
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 lg:p-6 page-enter">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
