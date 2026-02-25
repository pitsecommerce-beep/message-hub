import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import { useState } from 'react'
import { MessageSquare, Pencil } from 'lucide-react'
import { useUpdateFunnelStage } from '@/features/contacts/hooks/use-contacts'
import { FUNNEL_STAGES, type Contact, type FunnelStage } from '@/types'
import { cn, formatTimeAgo } from '@/lib/utils'
import { Timestamp } from 'firebase/firestore'

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}

interface ContactCardProps {
  contact: Contact
  isDragging?: boolean
  onOpenConversation: (id: string) => void
  onEdit?: (id: string) => void
}

function ContactCard({ contact, isDragging, onOpenConversation, onEdit }: ContactCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-white/5 p-3',
        'transition-all hover:border-white/20 hover:bg-white/8',
        isDragging && 'opacity-50 rotate-1 shadow-2xl',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 text-xs font-semibold shrink-0">
            {contact.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{contact.name}</p>
            {contact.company && (
              <p className="text-xs text-gray-500 truncate">{contact.company}</p>
            )}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(contact.id) }}
              className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/10"
            >
              <Pencil size={11} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenConversation(contact.id) }}
            className="p-1 rounded text-gray-600 hover:text-brand-400 hover:bg-brand-600/10"
          >
            <MessageSquare size={11} />
          </button>
        </div>
      </div>
      {contact.phone && (
        <p className="text-xs text-gray-600 mt-1.5 truncate">{contact.phone}</p>
      )}
      {contact.funnelUpdatedAt && (
        <p className="text-xs text-gray-700 mt-1">
          {formatTimeAgo(toDate(contact.funnelUpdatedAt))}
        </p>
      )}
    </div>
  )
}

// ─── Draggable card wrapper — must be its own component so useDraggable
//     is called at component level, not inside a .map() callback
function DraggableContactCard({
  contact,
  onOpenConversation,
}: {
  contact: Contact
  onOpenConversation: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: contact.id,
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing touch-none"
    >
      <ContactCard
        contact={contact}
        isDragging={isDragging}
        onOpenConversation={onOpenConversation}
      />
    </div>
  )
}

interface DroppableColumnProps {
  stage: typeof FUNNEL_STAGES[number]
  contacts: Contact[]
  onOpenConversation: (id: string) => void
}

function DroppableColumn({ stage, contacts, onOpenConversation }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  return (
    <div className="flex flex-col min-w-[240px] w-[240px]">
      {/* Column header */}
      <div className="flex items-center justify-between mb-2.5 px-1">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-gray-200">{stage.name}</span>
        </div>
        <span
          className="text-xs font-medium text-white rounded-full px-2.5 py-0.5"
          style={{ backgroundColor: `${stage.color}25`, color: stage.color }}
        >
          {contacts.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 min-h-[300px] rounded-xl p-2 space-y-2 border border-dashed transition-all duration-200',
          isOver
            ? 'border-brand-500/60 bg-brand-600/8 scale-[1.01]'
            : 'border-white/8 bg-white/[0.02]',
        )}
      >
        {contacts.map((contact) => (
          <DraggableContactCard
            key={contact.id}
            contact={contact}
            onOpenConversation={onOpenConversation}
          />
        ))}
        {contacts.length === 0 && (
          <div className="flex items-center justify-center h-20">
            <p className="text-xs text-gray-700">Arrastra aquí</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface FunnelViewProps {
  contacts: Contact[]
  orgId: string | undefined
  onOpenConversation: (contactId: string) => void
}

export default function FunnelView({ contacts, orgId, onOpenConversation }: FunnelViewProps) {
  const updateStage = useUpdateFunnelStage(orgId)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const contactsByStage = FUNNEL_STAGES.reduce<Record<FunnelStage, Contact[]>>(
    (acc, s) => {
      acc[s.id] = contacts.filter((c) => c.funnelStage === s.id)
      return acc
    },
    {} as Record<FunnelStage, Contact[]>,
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const newStage = over.id as FunnelStage
    if (!FUNNEL_STAGES.find((s) => s.id === newStage)) return
    await updateStage.mutateAsync({ id: active.id as string, stage: newStage })
  }

  const activeContact = activeId ? contacts.find((c) => c.id === activeId) : null

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]">
        {FUNNEL_STAGES.map((stage) => (
          <DroppableColumn
            key={stage.id}
            stage={stage}
            contacts={contactsByStage[stage.id] ?? []}
            onOpenConversation={onOpenConversation}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
        {activeContact && (
          <div className="rotate-2 opacity-95 w-[240px]">
            <ContactCard contact={activeContact} isDragging onOpenConversation={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
