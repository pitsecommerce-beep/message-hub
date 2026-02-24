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
        'rounded-xl border border-white/10 bg-white/5 p-3 cursor-grab active:cursor-grabbing',
        'transition-all hover:border-white/20 hover:bg-white/8',
        isDragging && 'opacity-50',
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
      {contact.funnelUpdatedAt && (
        <p className="text-xs text-gray-600 mt-1.5">
          {formatTimeAgo(toDate(contact.funnelUpdatedAt))}
        </p>
      )}
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
    <div className="flex flex-col min-w-[220px] w-[220px]">
      {/* Column header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="text-xs font-semibold text-gray-300">{stage.name}</span>
        </div>
        <span className="text-xs text-gray-600 bg-white/8 rounded-full px-2 py-0.5">
          {contacts.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 min-h-[200px] rounded-xl p-2 space-y-2 border border-dashed transition-colors',
          isOver ? 'border-brand-500/60 bg-brand-600/5' : 'border-white/8 bg-white/3',
        )}
      >
        {contacts.map((contact) => {
          const { attributes, listeners, setNodeRef: setDraggableRef, transform } = useDraggable({
            id: contact.id,
          })

          const style = transform
            ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
            : undefined

          return (
            <div
              key={contact.id}
              ref={setDraggableRef}
              style={style}
              {...attributes}
              {...listeners}
            >
              <ContactCard
                contact={contact}
                onOpenConversation={onOpenConversation}
              />
            </div>
          )
        })}
        {contacts.length === 0 && (
          <div className="flex items-center justify-center h-16">
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

  // Contacts with no stage
  const unsorted = contacts.filter((c) => !c.funnelStage)

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
      <div className="flex gap-3 overflow-x-auto pb-4">
        {FUNNEL_STAGES.map((stage) => (
          <DroppableColumn
            key={stage.id}
            stage={stage}
            contacts={contactsByStage[stage.id] ?? []}
            onOpenConversation={onOpenConversation}
          />
        ))}
      </div>

      <DragOverlay>
        {activeContact && (
          <div className="rotate-2 opacity-90">
            <ContactCard contact={activeContact} isDragging onOpenConversation={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
