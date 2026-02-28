import { useState, useMemo, useCallback } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShoppingBag, Search, RefreshCw, Plus, Trash2, SearchIcon } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { useAppStore } from '@/store/app.store'
import { useOrders, useUpdateOrderStatus, useCreateOrder } from '@/features/orders/hooks/use-orders'
import { useContacts } from '@/features/contacts/hooks/use-contacts'
import { useKnowledgeBases, useKBRows } from '@/features/knowledge-base/hooks/use-knowledge-base'
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
import type { Order, OrderStatus, OrderItem } from '@/types'

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

// ─── SKU Search helper ────────────────────────────────────────────────────────

interface KBProduct {
  sku: string
  description: string
  unitPrice: number
  raw: Record<string, unknown>
}

function detectSKUColumn(cols: string[]): string | null {
  const lower = cols.map((c) => c.toLowerCase())
  for (const kw of ['sku', 'codigo', 'código', 'code', 'clave', 'num_parte', 'parte_no']) {
    const idx = lower.findIndex((c) => c.includes(kw))
    if (idx >= 0) return cols[idx]
  }
  return null
}

function detectDescriptionColumn(cols: string[]): string | null {
  const lower = cols.map((c) => c.toLowerCase())
  for (const kw of ['descripcion', 'descripción', 'description', 'nombre', 'producto', 'product', 'name']) {
    const idx = lower.findIndex((c) => c.includes(kw))
    if (idx >= 0) return cols[idx]
  }
  return null
}

function detectPriceColumn(cols: string[]): string | null {
  const lower = cols.map((c) => c.toLowerCase())
  for (const kw of ['precio_venta', 'precio venta', 'price', 'precio', 'pvp', 'venta', 'costo_venta']) {
    const idx = lower.findIndex((c) => c.includes(kw))
    if (idx >= 0) return cols[idx]
  }
  return null
}

// ─── Order creation dialog ─────────────────────────────────────────────────────

interface LineItem {
  sku: string
  description: string
  quantity: number
  unitPrice: number
}

const orderSchema = z.object({
  contactId: z.string().min(1, 'Selecciona un contacto'),
  status: z.enum(['pendiente', 'pago_pendiente', 'procesando', 'enviado', 'entregado', 'cancelado']),
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
  const { data: knowledgeBases = [] } = useKnowledgeBases(orgId)
  const createOrder = useCreateOrder(orgId)

  const [selectedKB, setSelectedKB] = useState<string>('')
  const { data: kbRows = [] } = useKBRows(orgId, selectedKB || undefined)

  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [skuSearch, setSkuSearch] = useState('')
  const [showResults, setShowResults] = useState(false)

  // Detect KB column mappings
  const kbMeta = knowledgeBases.find((kb) => kb.id === selectedKB)
  const skuCol = kbMeta?.columns ? detectSKUColumn(kbMeta.columns) : null
  const descCol = kbMeta?.columns ? detectDescriptionColumn(kbMeta.columns) : null
  const priceCol = kbMeta?.columns ? detectPriceColumn(kbMeta.columns) : null

  // Search KB rows
  const searchResults = useMemo(() => {
    if (!skuSearch.trim() || kbRows.length === 0) return []
    const q = skuSearch.toLowerCase()
    return kbRows
      .filter((row) => {
        const vals = Object.values(row).map((v) => String(v ?? '').toLowerCase())
        return vals.some((v) => v.includes(q))
      })
      .slice(0, 10)
      .map((row): KBProduct => ({
        sku: String(skuCol ? (row[skuCol] ?? '') : ''),
        description: String(descCol ? (row[descCol] ?? '') : Object.values(row).slice(0, 3).join(' - ')),
        unitPrice: priceCol ? Number(row[priceCol]) || 0 : 0,
        raw: row,
      }))
  }, [skuSearch, kbRows, skuCol, descCol, priceCol])

  function addFromKB(product: KBProduct) {
    setLineItems((prev) => [
      ...prev,
      { sku: product.sku, description: product.description, quantity: 1, unitPrice: product.unitPrice },
    ])
    setSkuSearch('')
    setShowResults(false)
  }

  function addEmptyLine() {
    setLineItems((prev) => [...prev, { sku: '', description: '', quantity: 1, unitPrice: 0 }])
  }

  function updateLine(idx: number, field: keyof LineItem, value: string | number) {
    setLineItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  function removeLine(idx: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const orderTotal = lineItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { status: 'pendiente' },
  })

  function handleClose() {
    if (createOrder.isPending) return
    onOpenChange(false)
    reset()
    setLineItems([])
    setSkuSearch('')
    setSelectedKB('')
  }

  async function onSubmit(data: OrderForm) {
    if (lineItems.length === 0) return
    const contact = contacts.find((c) => c.id === data.contactId)
    if (!contact) return

    const items: OrderItem[] = lineItems.map((li) => ({
      sku: li.sku || undefined,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      total: li.quantity * li.unitPrice,
    }))

    await createOrder.mutateAsync({
      contactId: contact.id,
      contactName: contact.name,
      status: data.status as OrderStatus,
      items,
      total: orderTotal,
      notes: data.notes?.trim() || undefined,
    })
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear Pedido</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Contact & Status */}
          <div className="grid grid-cols-2 gap-3">
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
          </div>

          {/* KB selector + SKU search */}
          <div className="space-y-2">
            <Label>Buscar producto en base de conocimientos</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select value={selectedKB} onValueChange={setSelectedKB}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona base de datos..." />
                </SelectTrigger>
                <SelectContent>
                  {knowledgeBases.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      {kb.name} ({kb.rowCount ?? 0} productos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <Input
                  className="pl-8"
                  placeholder={selectedKB ? 'Buscar SKU o descripción...' : 'Selecciona una base primero'}
                  value={skuSearch}
                  onChange={(e) => { setSkuSearch(e.target.value); setShowResults(true) }}
                  onFocus={() => setShowResults(true)}
                  disabled={!selectedKB}
                />
              </div>
            </div>

            {/* Search results dropdown */}
            {showResults && searchResults.length > 0 && (
              <div className="rounded-lg border border-white/10 bg-gray-900 max-h-40 overflow-y-auto">
                {searchResults.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors flex items-center justify-between gap-2"
                    onClick={() => addFromKB(p)}
                  >
                    <div className="min-w-0">
                      <span className="text-gray-400 font-mono mr-2">{p.sku || '—'}</span>
                      <span className="text-gray-200 truncate">{p.description}</span>
                    </div>
                    {p.unitPrice > 0 && (
                      <span className="text-green-400 font-medium shrink-0">{formatCurrency(p.unitPrice)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Artículos del pedido *</Label>
              <Button type="button" variant="outline" size="sm" onClick={addEmptyLine}>
                <Plus size={12} /> Línea manual
              </Button>
            </div>

            {lineItems.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4 border border-dashed border-white/10 rounded-lg">
                Busca productos arriba o agrega una línea manual
              </p>
            )}

            {lineItems.length > 0 && (
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-2 py-2 text-left text-gray-500">SKU</th>
                      <th className="px-2 py-2 text-left text-gray-500">Descripción</th>
                      <th className="px-2 py-2 text-right text-gray-500 w-16">Cant.</th>
                      <th className="px-2 py-2 text-right text-gray-500 w-24">P. Unit.</th>
                      <th className="px-2 py-2 text-right text-gray-500 w-24">Subtotal</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {lineItems.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-2 py-1">
                          <Input
                            className="h-7 text-xs font-mono"
                            value={item.sku}
                            onChange={(e) => updateLine(idx, 'sku', e.target.value)}
                            placeholder="SKU"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            className="h-7 text-xs"
                            value={item.description}
                            onChange={(e) => updateLine(idx, 'description', e.target.value)}
                            placeholder="Descripción del producto"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            min="1"
                            className="h-7 text-xs text-right w-16"
                            value={item.quantity}
                            onChange={(e) => updateLine(idx, 'quantity', parseInt(e.target.value) || 1)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-7 text-xs text-right w-24"
                            value={item.unitPrice}
                            onChange={(e) => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-2 py-1 text-right text-white font-medium">
                          {formatCurrency(item.quantity * item.unitPrice)}
                        </td>
                        <td className="px-2 py-1">
                          <button type="button" onClick={() => removeLine(idx)} className="text-gray-600 hover:text-red-400">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-white/5">
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-gray-400 font-semibold text-xs">Total</td>
                      <td className="px-2 py-2 text-right text-white font-bold text-sm">{formatCurrency(orderTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea
              placeholder="Detalles del pedido..."
              rows={2}
              {...register('notes')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={createOrder.isPending}>
              Cancelar
            </Button>
            <Button type="submit" loading={createOrder.isPending} disabled={lineItems.length === 0}>
              Crear Pedido
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Order row ─────────────────────────────────────────────────────────────────

function safeCurrency(val: unknown): string {
  const n = Number(val)
  return isNaN(n) ? '$0.00' : formatCurrency(n)
}

interface OrderRowProps {
  order: Order
  onStatusChange: (orderId: string, status: OrderStatus) => void
  isUpdating: boolean
}

function OrderRow({ order, onStatusChange, isUpdating }: OrderRowProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const config = STATUS_CONFIG[order.status] ?? { label: order.status, variant: 'secondary' as const }
  const hasItems = order.items && order.items.length > 0

  return (
    <>
      <tr className="hover:bg-white/3 transition-colors cursor-pointer" onClick={() => hasItems && setExpanded(!expanded)}>
        <td className="px-4 py-3">
          <div>
            <button
              className="text-sm font-medium text-brand-400 hover:text-brand-300 hover:underline font-mono text-left"
              onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.id}`) }}
            >
              {order.orderNumber}
            </button>
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
            {order.total != null ? safeCurrency(order.total) : '—'}
          </p>
          {hasItems && (
            <button
              className="text-xs text-brand-400 hover:underline"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            >
              {order.items!.length} artículo(s) {expanded ? '▲' : '▼'}
            </button>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-400 max-w-[200px] truncate">
          {order.notes ?? '—'}
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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
      {expanded && hasItems && (
        <tr>
          <td colSpan={6} className="px-4 pb-3">
            <div className="ml-4 rounded-lg border border-white/8 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-white/5">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-semibold">SKU</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-semibold">Descripción</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-semibold">Cant.</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-semibold">P. Unitario</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-semibold">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {order.items!.map((item, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-gray-400 font-mono">{item.sku || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-200">{item.description || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-300 text-right">{item.quantity}</td>
                      <td className="px-3 py-1.5 text-gray-300 text-right">{safeCurrency(item.unitPrice)}</td>
                      <td className="px-3 py-1.5 text-white font-medium text-right">{safeCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-white/5">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-gray-400 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right text-white font-bold">
                      {safeCurrency(order.total ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
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
