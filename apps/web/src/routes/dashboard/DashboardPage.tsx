import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { MessageSquare, Users, ShoppingBag, TrendingUp, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import { useDashboard } from '@/features/dashboard/hooks/use-dashboard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: number | string
  icon: React.ReactNode
  description?: string
  badge?: { label: string; variant?: 'success' | 'warning' | 'info' }
}

function StatCard({ title, value, icon, description, badge }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
          {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
        </div>
        <div className="h-10 w-10 rounded-xl bg-brand-600/15 flex items-center justify-center text-brand-400">
          {icon}
        </div>
      </div>
      {badge && (
        <div className="mt-3">
          <Badge variant={badge.variant ?? 'info'}>{badge.label}</Badge>
        </div>
      )}
    </Card>
  )
}

export default function DashboardPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id
  const { data, isLoading, error, refetch } = useDashboard(orgId)

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-400">Error al cargar el dashboard</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw size={14} /> Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Hola, {userData?.name?.split(' ')[0] ?? 'usuario'} 👋
          </h2>
          <p className="text-sm text-gray-500">
            {organization?.name ?? 'Tu organización'} — resumen de actividad
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          Actualizar
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Conversaciones"
          value={isLoading ? '—' : (data?.totalConversations ?? 0)}
          icon={<MessageSquare size={20} />}
          description="Total en la organización"
        />
        <StatCard
          title="Activas"
          value={isLoading ? '—' : (data?.activeConversations ?? 0)}
          icon={<TrendingUp size={20} />}
          description="Sin marcar como entregado"
          badge={
            data && data.activeConversations > 0
              ? { label: 'Requieren atención', variant: 'warning' }
              : undefined
          }
        />
        <StatCard
          title="Contactos"
          value={isLoading ? '—' : (data?.totalContacts ?? 0)}
          icon={<Users size={20} />}
          description="En tu directorio"
        />
        <StatCard
          title="Pedidos"
          value={isLoading ? '—' : (data?.totalOrders ?? 0)}
          icon={<ShoppingBag size={20} />}
          description={
            data ? `${data.pendingOrders} pendientes / en proceso` : undefined
          }
          badge={
            data && data.pendingOrders > 0
              ? { label: `${data.pendingOrders} por procesar`, variant: 'warning' }
              : undefined
          }
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Conversations area chart */}
        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente</CardTitle>
            <CardDescription>Conversaciones activas últimos 7 días</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="h-48 flex items-center justify-center">
                <div className="text-gray-600 text-sm animate-pulse">Cargando...</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data?.recentConversations ?? []}>
                  <defs>
                    <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#444CE7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#444CE7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#6B7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#6B7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111827',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    itemStyle={{ color: '#E5E7EB' }}
                    labelStyle={{ color: '#9CA3AF' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#444CE7"
                    strokeWidth={2}
                    fill="url(#convGrad)"
                    name="Conversaciones"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Funnel pie chart */}
        <Card>
          <CardHeader>
            <CardTitle>Funnel de Ventas</CardTitle>
            <CardDescription>Distribución de contactos por etapa</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="h-48 flex items-center justify-center">
                <div className="text-gray-600 text-sm animate-pulse">Cargando...</div>
              </div>
            ) : !data?.funnelDistribution.length ? (
              <div className="h-48 flex items-center justify-center">
                <p className="text-sm text-gray-600">Sin contactos en el funnel aún</p>
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={180}>
                  <PieChart>
                    <Pie
                      data={data.funnelDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="count"
                    >
                      {data.funnelDistribution.map((entry) => (
                        <Cell key={entry.stage} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      itemStyle={{ color: '#E5E7EB' }}
                      formatter={(value: number, _: string, props: { payload?: { stageName: string } }) => [
                        value,
                        props.payload?.stageName ?? '',
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {data.funnelDistribution.map((entry) => (
                    <div key={entry.stage} className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-xs text-gray-400 flex-1 truncate">{entry.stageName}</span>
                      <span className="text-xs font-medium text-white">{entry.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
