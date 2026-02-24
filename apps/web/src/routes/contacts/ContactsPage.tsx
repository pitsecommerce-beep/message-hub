import { useState, useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { Plus, Search, Pencil, Trash2, ArrowUpDown } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import {
  useContacts,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
} from '@/features/contacts/hooks/use-contacts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { FUNNEL_STAGES, type Contact, type FunnelStage } from '@/types'
import ContactDialog from './ContactDialog'

const STAGE_VARIANTS: Record<FunnelStage, 'info' | 'warning' | 'destructive' | 'default' | 'success'> = {
  curioso: 'info',
  cotizando: 'warning',
  pago_pendiente: 'destructive',
  orden_pendiente: 'default',
  entregado: 'success',
  atencion_inmediata: 'warning',
}

const columnHelper = createColumnHelper<Contact>()

export default function ContactsPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id

  const { data: contacts = [], isLoading } = useContacts(orgId)
  const createContact = useCreateContact(orgId)
  const updateContact = useUpdateContact(orgId)
  const deleteContact = useDeleteContact(orgId)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: ({ column }) => (
          <button
            className="flex items-center gap-1 text-gray-400 hover:text-white"
            onClick={() => column.toggleSorting()}
          >
            Nombre <ArrowUpDown size={12} />
          </button>
        ),
        cell: (info) => (
          <div>
            <p className="text-sm font-medium text-white">{info.getValue()}</p>
            {info.row.original.company && (
              <p className="text-xs text-gray-500">{info.row.original.company}</p>
            )}
          </div>
        ),
      }),
      columnHelper.accessor('phone', {
        header: 'Teléfono',
        cell: (info) => (
          <span className="text-sm text-gray-300">{info.getValue() ?? '—'}</span>
        ),
      }),
      columnHelper.accessor('email', {
        header: 'Correo',
        cell: (info) => (
          <span className="text-sm text-gray-300 truncate max-w-[180px] block">
            {info.getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.accessor('funnelStage', {
        header: 'Etapa',
        cell: (info) => {
          const stage = info.getValue()
          if (!stage) return <span className="text-xs text-gray-600">—</span>
          const stageInfo = FUNNEL_STAGES.find((s) => s.id === stage)
          return (
            <Badge variant={STAGE_VARIANTS[stage]}>
              {stageInfo?.name ?? stage}
            </Badge>
          )
        },
      }),
      columnHelper.display({
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setEditingContact(row.original)
                setDialogOpen(true)
              }}
            >
              <Pencil size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-gray-500 hover:text-red-400"
              onClick={() => {
                if (confirm(`¿Eliminar a ${row.original.name}?`)) {
                  deleteContact.mutate(row.original.id)
                }
              }}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ),
      }),
    ],
    [deleteContact],
  )

  const table = useReactTable({
    data: contacts,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  function openCreate() {
    setEditingContact(null)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <Input
            className="pl-8"
            placeholder="Buscar contactos..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus size={14} /> Agregar Contacto
        </Button>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        {FUNNEL_STAGES.map((s) => {
          const count = contacts.filter((c) => c.funnelStage === s.id).length
          if (count === 0) return null
          return (
            <span key={s.id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-gray-300">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}: {count}
            </span>
          )
        })}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                    >
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-600 animate-pulse">
                    Cargando...
                  </td>
                </tr>
              )}
              {!isLoading && table.getRowModel().rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-600">
                    {globalFilter ? 'Sin resultados' : 'Sin contactos aún'}
                  </td>
                </tr>
              )}
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-white/3 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-white/8 text-xs text-gray-600">
          {table.getFilteredRowModel().rows.length} contactos
        </div>
      </div>

      {/* Contact dialog */}
      <ContactDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingContact(null) }}
        contact={editingContact}
        onSave={async (data) => {
          const { funnelStage, ...rest } = data
          const stage = funnelStage && funnelStage.length > 0
            ? funnelStage as import('@/types').FunnelStage
            : undefined
          if (editingContact) {
            await updateContact.mutateAsync({ id: editingContact.id, ...rest, funnelStage: stage })
          } else {
            await createContact.mutateAsync({ ...rest, funnelStage: stage })
          }
          setDialogOpen(false)
        }}
        isSaving={createContact.isPending || updateContact.isPending}
      />
    </div>
  )
}
