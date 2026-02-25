import { useQuery } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

interface DashboardStats {
  totalConversations: number
  activeConversations: number
  totalContacts: number
  totalOrders: number
  pendingOrders: number
  recentConversations: Array<{
    date: string
    count: number
  }>
  funnelDistribution: Array<{
    stage: string
    stageName: string
    count: number
    color: string
  }>
}

const FUNNEL_NAMES: Record<string, string> = {
  curioso: 'Curioso',
  cotizando: 'Cotizando',
  pago_pendiente: 'Pago Pendiente',
  orden_pendiente: 'Orden Pendiente',
  entregado: 'Entregado',
  atencion_inmediata: 'Atención Inmediata',
}

const FUNNEL_COLORS: Record<string, string> = {
  curioso: '#3B82F6',
  cotizando: '#F59E0B',
  pago_pendiente: '#EF4444',
  orden_pendiente: '#8B5CF6',
  entregado: '#10B981',
  atencion_inmediata: '#EC4899',
}

export function useDashboard(orgId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: async (): Promise<DashboardStats> => {
      if (!orgId) throw new Error('No orgId')

      // Use allSettled so one failing collection doesn't break the whole dashboard
      const [convsResult, contactsResult, ordersResult] = await Promise.allSettled([
        getDocs(query(collection(db, 'conversations'), where('orgId', '==', orgId))),
        getDocs(query(collection(db, 'contacts'), where('orgId', '==', orgId))),
        getDocs(query(collection(db, 'orders'), where('orgId', '==', orgId))),
      ])

      const convs = convsResult.status === 'fulfilled'
        ? convsResult.value.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
            id: string
            funnelStage?: string
            lastMessageAt?: Timestamp
          }>
        : []

      const contacts = contactsResult.status === 'fulfilled'
        ? contactsResult.value.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
            id: string
            funnelStage?: string
          }>
        : []

      const orders = ordersResult.status === 'fulfilled'
        ? ordersResult.value.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
            id: string
            status: string
          }>
        : []

      // Last 7 days conversation stats
      const now = new Date()
      const recentConversations = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now)
        d.setDate(d.getDate() - (6 - i))
        const dateStr = d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
        const dayStart = new Date(d.setHours(0, 0, 0, 0))
        const dayEnd = new Date(d.setHours(23, 59, 59, 999))
        const count = convs.filter((c) => {
          const ts = c.lastMessageAt
          if (!ts) return false
          const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts as unknown as number)
          return date >= dayStart && date <= dayEnd
        }).length
        return { date: dateStr, count }
      })

      // Funnel distribution from contacts
      const funnelMap: Record<string, number> = {}
      contacts.forEach((c) => {
        if (c.funnelStage) {
          funnelMap[c.funnelStage] = (funnelMap[c.funnelStage] ?? 0) + 1
        }
      })

      const funnelDistribution = Object.entries(funnelMap).map(([stage, count]) => ({
        stage,
        stageName: FUNNEL_NAMES[stage] ?? stage,
        count,
        color: FUNNEL_COLORS[stage] ?? '#6B7280',
      }))

      return {
        totalConversations: convs.length,
        activeConversations: convs.filter((c) => c.funnelStage !== 'entregado').length,
        totalContacts: contacts.length,
        totalOrders: orders.length,
        pendingOrders: orders.filter((o) => o.status === 'pendiente' || o.status === 'procesando').length,
        recentConversations,
        funnelDistribution,
      }
    },
    enabled: !!orgId,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  })
}
