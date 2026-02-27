import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShoppingBag, Search, RefreshCw, Plus } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { useAppStore } from '@/store/app.store'
import { useOrders, useUpdateOrderStatus, useCreateOrder } from '@/features/orders/hooks/use-orders'
import { useContacts } from '@/features/contacts/hooks/use-contacts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import type { Order, OrderStatus } from '@/types'

const STATUS_CONFIG: Record<OrderStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  pendiente: { label: 'Pendiente', variant: 'warning' },
  pago_pendiente: { label: 'Pago Pendiente', variant: 'destructive' },
  procesando: { label: 'Procesando', variant: 'info' },
  enviado: { label: 'Enviado', variant: 'info' },
  entregado: { label: 'Entregado', variant: 'success' },
  cancelado: { label: 'Cancelado', variant: 'secondary' },
}

const STATUS_OPTIONS: OrderStatus[] = ['pendiente', 'pago_pendiente', 'procesando', 'enviado', 'entregado', 'cancelado']

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}

function formatDate(ts: unknown): string {
  const d = toDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'pago_pendiente', label: 'Pago Pendiente' },
  { value: 'procesando', label: 'Procesando' },
  { value: 'enviado', label: 'Enviados' },
  { value: 'entregado', label: 'Entregados' },
  { value: 'cancelado', label: 'Cancelados' },
]

// ─── Order creation dialog ─────────────────────────────────────────────────────

const orderSchema = z.object({
  contactId: z.string().min(1, 'Selecciona un contacto'),
  status: z.enum(['pendiente', 'pago_pendiente', 'procesando', 'enviado', 'entregado', 'cancelado']),
  total: z.string().optional(),
  notes: z.string().optional(),
})
type OrderForm = z.infer<typeof orderSchema>

function CreateOrderDialog({
  open,
  onOpenChange,
  orgId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string | undefined
}) {
  const { data: contacts = [] } = useContacts(orgId)
  const createOrder = useCreateOrder(orgId)

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { status: 'pendiente' },
  })

  async function onSubmit(data: OrderForm) {
    const contact = contacts.find((c) => c.id === data.contactId)
    if (!contact) return
    const totalNum = data.total ? parseFloat(data.total) : undefined
    await createOrder.mutateAsync({
      contactId: contact.id,
      contactName: contact.name,
      status: data.status as OrderStatus,
      total: totalNum && !isNaN(totalNum) ? totalNum : undefined,
      notes: data.notes?.trim() || undefined,
    })
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!createOrder.isPending) { onOpenChange(o); if (!o) reset() } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Crear Pedido</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Contacto *</Label>
            <Controller
              name="contactId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un contacto..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.company ? `— ${c.company}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.contactId && <p className="text-xs text-red-400">{errors.contactId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Estado *</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Total (opcional)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...register('total')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea
              placeholder="Detalles del pedido..."
              rows={3}
              {...register('notes')}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { onOpenChange(false); reset() }}
              disabled={createOrder.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={createOrder.isPending}>
              Crear Pedido
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Order row ─────────────────────────────────────────────────────────────────

interface OrderRowProps {
  order: Order
  onStatusChange: (orderId: string, status: OrderStatus) => void
  isUpdating: boolean
}

function OrderRow({ order, onStatusChange, isUpdating }: OrderRowProps) {
  const config = STATUS_CONFIG[order.status] ?? { label: order.status, variant: 'secondary' as const }
  return (
    <tr className="hover:bg-white/3 transition-colors">
      <td className="px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white font-mono">{order.orderNumber}</p>
          <p className="text-xs text-gray-500">{formatDate(order.createdAt)}</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-gray-200">{order.contactName}</p>
      </td>
      <td className="px-4 py-3">
        <Badge variant={config.variant}>{config.label}</Badge>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-white font-medium">
          {order.total != null ? formatCurrency(order.total) : '—'}
        </p>
        {order.items && order.items.length > 0 && (
          <p className="text-xs text-gray-500">{order.items.length} artículo(s)</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400 max-w-[200px] truncate">
        {order.notes ?? '—'}
      </td>
      <td className="px-4 py-3">
        <Select
          value={order.status}
          onValueChange={(v) => onStatusChange(order.id, v as OrderStatus)}
          disabled={isUpdating}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {STATUS_CONFIG[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
    </tr>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id

  const { data: orders = [], isLoading, refetch } = useOrders(orgId)
  const updateStatus = useUpdateOrderStatus(orgId)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = orders.filter((o) => {
    const matchSearch =
      o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      o.contactName.toLowerCase().includes(search.toLowerCase()) ||
      (o.notes ?? '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || o.status === statusFilter
    return matchSearch && matchStatus
  })

  const stats = {
    total: orders.length,
    pending: orders.filter((o) => o.status === 'pendiente' || o.status === 'pago_pendiente').length,
    processing: orders.filter((o) => o.status === 'procesando').length,
    delivered: orders.filter((o) => o.status === 'entregado').length,
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-white' },
          { label: 'Pendientes', value: stats.pending, color: 'text-amber-400' },
          { label: 'Procesando', value: stats.processing, color: 'text-blue-400' },
          { label: 'Entregados', value: stats.delivered, color: 'text-green-400' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <Input
            className="pl-8"
            placeholder="Buscar pedidos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                statusFilter === f.value
                  ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {f.label}
            </button>
          ))}
          <Button variant="ghost" size="icon-sm" onClick={() => refetch()}>
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={13} /> Crear Pedido
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                {['Número', 'Contacto', 'Estado', 'Total', 'Notas', 'Cambiar estado'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-600 animate-pulse">
                    Cargando...
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <ShoppingBag size={32} className="text-gray-700" />
                      <p className="text-gray-600">
                        {search || statusFilter !== 'all'
                          ? 'Sin resultados'
                          : 'Sin pedidos aún. Crea uno manualmente o el agente IA los generará automáticamente.'}
                      </p>
                      {!search && statusFilter === 'all' && (
                        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                          <Plus size={13} /> Crear primer pedido
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  onStatusChange={(id, status) => updateStatus.mutate({ orderId: id, status })}
                  isUpdating={updateStatus.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-white/8 text-xs text-gray-600">
          {filtered.length} pedidos
        </div>
      </div>

      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} />
    </div>
  )
}
