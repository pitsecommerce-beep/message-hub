import type { ComponentType } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import {
  ArrowLeft,
  Package,
  User,
  MapPin,
  Phone,
  Mail,
  Building2,
  Clock,
  Hash,
  FileText,
  Truck,
  CreditCard,
} from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import { useOrder, useUpdateOrderStatus } from '@/features/orders/hooks/use-orders'
import { useContact } from '@/features/contacts/hooks/use-contacts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import type { OrderStatus } from '@/types'

const STATUS_CONFIG: Record<OrderStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'destructive' | 'secondary'; color: string }> = {
  pendiente:      { label: 'Pendiente',       variant: 'warning',     color: 'text-amber-400' },
  pago_pendiente: { label: 'Pago Pendiente',  variant: 'destructive', color: 'text-red-400' },
  procesando:     { label: 'Procesando',      variant: 'info',        color: 'text-blue-400' },
  enviado:        { label: 'Enviado',         variant: 'info',        color: 'text-blue-400' },
  entregado:      { label: 'Entregado',       variant: 'success',     color: 'text-green-400' },
  cancelado:      { label: 'Cancelado',       variant: 'secondary',   color: 'text-gray-400' },
}

const STATUS_OPTIONS: OrderStatus[] = ['pendiente', 'pago_pendiente', 'procesando', 'enviado', 'entregado', 'cancelado']

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}

function formatDateTime(ts: unknown): string {
  const d = toDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateShort(ts: unknown): string {
  const d = toDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function safeCurrency(val: unknown): string {
  const n = Number(val)
  return isNaN(n) ? '$0.00' : formatCurrency(n)
}

function InfoRow({ icon: Icon, label, value }: { icon: ComponentType<{ size?: number; className?: string }>; label: string; value: string | undefined | null }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 rounded-lg bg-white/5 p-2">
        <Icon size={14} className="text-gray-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-600 uppercase tracking-wider font-medium">{label}</p>
        <p className="text-sm text-gray-200 mt-0.5 break-words">{value || '—'}</p>
      </div>
    </div>
  )
}

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id

  const { data: order, isLoading: orderLoading } = useOrder(orgId, orderId)
  const { data: contact, isLoading: contactLoading } = useContact(orgId, order?.contactId)
  const updateStatus = useUpdateOrderStatus(orgId)

  if (orderLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Cargando pedido...</p>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center space-y-3">
          <Package size={40} className="text-gray-700 mx-auto" />
          <p className="text-gray-500">Pedido no encontrado</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/orders')}>
            <ArrowLeft size={14} /> Volver a Pedidos
          </Button>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[order.status] ?? { label: order.status, variant: 'secondary' as const, color: 'text-gray-400' }
  const hasItems = order.items && order.items.length > 0
  const itemCount = order.items?.length ?? 0
  const totalUnits = order.items?.reduce((sum, i) => sum + (i.quantity || 0), 0) ?? 0

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate('/orders')}>
          <ArrowLeft size={16} />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-bold text-white font-mono">{order.orderNumber}</h1>
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Creado {formatDateTime(order.createdAt)}
            {order.updatedAt && ` · Actualizado ${formatDateShort(order.updatedAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={order.status}
            onValueChange={(v) => updateStatus.mutate({ orderId: order.id, status: v as OrderStatus })}
            disabled={updateStatus.isPending}
          >
            <SelectTrigger className="h-9 w-44 text-xs">
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
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <CreditCard size={14} className="text-green-400" />
            <p className="text-xs text-gray-500">Total Pedido</p>
          </div>
          <p className="text-xl font-bold text-green-400 mt-1">{safeCurrency(order.total)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-blue-400" />
            <p className="text-xs text-gray-500">Artículos</p>
          </div>
          <p className="text-xl font-bold text-blue-400 mt-1">{itemCount} <span className="text-sm font-normal text-gray-500">líneas</span></p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Truck size={14} className="text-purple-400" />
            <p className="text-xs text-gray-500">Unidades Totales</p>
          </div>
          <p className="text-xl font-bold text-purple-400 mt-1">{totalUnits}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock size={14} className={statusConfig.color} />
            <p className="text-xs text-gray-500">Estado</p>
          </div>
          <p className={`text-xl font-bold mt-1 ${statusConfig.color}`}>{statusConfig.label}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Contact info - left column */}
        <div className="space-y-5">
          {/* Contact card */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 bg-white/5">
              <div className="flex items-center gap-2">
                <User size={14} className="text-brand-400" />
                <h2 className="text-sm font-semibold text-white">Contacto</h2>
              </div>
            </div>
            <div className="px-4 py-2 divide-y divide-white/5">
              {contactLoading ? (
                <p className="text-xs text-gray-600 py-4 text-center animate-pulse">Cargando contacto...</p>
              ) : contact ? (
                <>
                  <InfoRow icon={User} label="Nombre" value={contact.name} />
                  <InfoRow icon={Building2} label="Empresa" value={contact.company} />
                  <InfoRow icon={Phone} label="Teléfono" value={contact.phone} />
                  <InfoRow icon={Mail} label="Email" value={contact.email} />
                  <InfoRow icon={MapPin} label="Dirección" value={contact.address} />
                  {contact.rfc && <InfoRow icon={FileText} label="RFC" value={contact.rfc} />}
                  {contact.notes && <InfoRow icon={FileText} label="Notas del contacto" value={contact.notes} />}
                </>
              ) : (
                <>
                  <InfoRow icon={User} label="Nombre" value={order.contactName} />
                  <p className="text-xs text-gray-600 py-2">Contacto no encontrado en CRM</p>
                </>
              )}
            </div>
          </div>

          {/* Order metadata */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 bg-white/5">
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-brand-400" />
                <h2 className="text-sm font-semibold text-white">Detalles del Pedido</h2>
              </div>
            </div>
            <div className="px-4 py-2 divide-y divide-white/5">
              <InfoRow icon={Hash} label="Número de Pedido" value={order.orderNumber} />
              <InfoRow icon={Clock} label="Fecha de Creación" value={formatDateTime(order.createdAt)} />
              {order.updatedAt && <InfoRow icon={Clock} label="Última Actualización" value={formatDateTime(order.updatedAt)} />}
              {order.conversationId && <InfoRow icon={FileText} label="Origen" value="Conversación con agente IA" />}
              {order.notes && <InfoRow icon={FileText} label="Notas" value={order.notes} />}
            </div>
          </div>
        </div>

        {/* Items table - right column (2/3 width) */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 bg-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package size={14} className="text-brand-400" />
                  <h2 className="text-sm font-semibold text-white">Artículos del Pedido</h2>
                </div>
                <span className="text-xs text-gray-500">{itemCount} línea(s) · {totalUnits} unidad(es)</span>
              </div>
            </div>

            {!hasItems ? (
              <div className="px-4 py-8 text-center">
                <Package size={28} className="text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-600">Sin artículos registrados</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Descripción</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Cantidad</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">P. Unitario</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {order.items!.map((item, i) => {
                      const unitPrice = Number(item.unitPrice) || 0
                      const quantity = Number(item.quantity) || 0
                      const subtotal = Number(item.total) || (quantity * unitPrice)
                      return (
                        <tr key={i} className="hover:bg-white/3 transition-colors">
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">{i + 1}</td>
                          <td className="px-4 py-3">
                            {item.sku ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-white/8 text-xs font-mono text-gray-300">
                                {item.sku}
                              </span>
                            ) : (
                              <span className="text-gray-600 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-200">{item.description || '—'}</td>
                          <td className="px-4 py-3 text-right text-gray-300 font-medium">{quantity}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{safeCurrency(unitPrice)}</td>
                          <td className="px-4 py-3 text-right text-white font-semibold">{safeCurrency(subtotal)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-white/10">
                      <td colSpan={4} />
                      <td className="px-4 py-3 text-right text-xs text-gray-500 font-semibold uppercase">Subtotal</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-medium">{safeCurrency(order.total)}</td>
                    </tr>
                    <tr className="bg-white/5">
                      <td colSpan={4} />
                      <td className="px-4 py-3 text-right text-sm text-white font-bold uppercase">Total</td>
                      <td className="px-4 py-3 text-right text-lg text-green-400 font-bold">{safeCurrency(order.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
