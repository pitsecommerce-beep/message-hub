import { useState, useRef, useEffect } from 'react'
import {
  MessageSquare, Plus, Bot, BotOff, Trash2, Send,
  Search, Phone, Mail, Building2, ChevronLeft,
  Kanban, List, RefreshCw, User, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { Timestamp } from 'firebase/firestore'
import { useAppStore } from '@/store/app.store'
import {
  useConversations,
  useMessages,
  useSendMessage,
  useDeleteConversation,
  useToggleConvAI,
  useCreateConversation,
} from '@/features/conversations/hooks/use-conversations'
import { useContacts } from '@/features/contacts/hooks/use-contacts'
import { Button } from '@/components/ui/button'
import { cn, formatTimeAgo } from '@/lib/utils'
import type { Conversation, Platform, Contact } from '@/types'
import { FUNNEL_STAGES } from '@/types'
import FunnelView from './FunnelView'
import NewChatDialog from './NewChatDialog'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const PLATFORM_ICONS: Record<Platform, string> = {
  whatsapp: '📱',
  instagram: '📷',
  messenger: '💬',
}

const PLATFORM_COLORS: Record<Platform, string> = {
  whatsapp: '#25D366',
  instagram: '#E1306C',
  messenger: '#0084FF',
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}

type FilterTab = 'all' | 'whatsapp' | 'instagram' | 'messenger' | 'ai'
type ViewMode = 'conversations' | 'funnel'

// ─── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
}: {
  msg: { id: string; text: string; role: string; senderName?: string; timestamp?: unknown }
}) {
  const isAgent = msg.role === 'agent' || msg.role === 'ai'
  return (
    <div className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
          isAgent
            ? 'bg-brand-600 text-white rounded-br-md'
            : 'bg-white/8 text-gray-100 rounded-bl-md border border-white/8',
          msg.role === 'ai' && 'bg-purple-700/80 border-purple-500/20',
        )}
      >
        {msg.role === 'ai' && (
          <p className="text-xs text-purple-200 mb-1 font-semibold flex items-center gap-1">
            <Bot size={10} /> Agente IA
          </p>
        )}
        <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
        <p className={cn('text-xs mt-1.5', isAgent ? 'text-white/50' : 'text-gray-600')}>
          {formatTimeAgo(toDate(msg.timestamp))}
        </p>
      </div>
    </div>
  )
}

// ─── Contact Detail Panel ──────────────────────────────────────────────────────

function ContactPanel({ contact, conv }: { contact: Contact | undefined; conv: Conversation }) {
  const stage = FUNNEL_STAGES.find((s) => s.id === contact?.funnelStage)

  return (
    <div className="w-64 xl:w-72 border-l border-white/8 bg-gray-950/60 flex flex-col shrink-0 overflow-y-auto">
      <div className="p-5 border-b border-white/8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold"
            style={{
              background: `linear-gradient(135deg, ${PLATFORM_COLORS[conv.platform]}25, ${PLATFORM_COLORS[conv.platform]}10)`,
              border: `2px solid ${PLATFORM_COLORS[conv.platform]}30`,
              color: PLATFORM_COLORS[conv.platform],
            }}
          >
            {conv.contactName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-white">{conv.contactName}</p>
            {contact?.company && (
              <p className="text-sm text-gray-500 mt-0.5">{contact.company}</p>
            )}
          </div>
          {stage && (
            <span
              className="text-xs font-medium px-3 py-1 rounded-full"
              style={{
                backgroundColor: `${stage.color}20`,
                color: stage.color,
                border: `1px solid ${stage.color}30`,
              }}
            >
              {stage.name}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Información</p>
        {conv.contactPhone && (
          <div className="flex items-center gap-3 text-sm">
            <Phone size={13} className="text-gray-600 shrink-0" />
            <span className="text-gray-300">{conv.contactPhone}</span>
          </div>
        )}
        {contact?.email && (
          <div className="flex items-center gap-3 text-sm">
            <Mail size={13} className="text-gray-600 shrink-0" />
            <span className="text-gray-300 truncate">{contact.email}</span>
          </div>
        )}
        {contact?.company && (
          <div className="flex items-center gap-3 text-sm">
            <Building2 size={13} className="text-gray-600 shrink-0" />
            <span className="text-gray-300">{contact.company}</span>
          </div>
        )}
        <div className="flex items-center gap-3 text-sm">
          <span className="text-sm">{PLATFORM_ICONS[conv.platform]}</span>
          <span className="text-gray-400 capitalize">{conv.platform}</span>
        </div>
      </div>

      {contact?.notes && (
        <div className="px-4 pb-4">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Notas</p>
          <p className="text-sm text-gray-400 leading-relaxed">{contact.notes}</p>
        </div>
      )}
    </div>
  )
}

// ─── Conversation Chat Panel ───────────────────────────────────────────────────

function ConversationPanel({
  conv,
  contact,
  onClose,
  userName,
}: {
  conv: Conversation
  contact: Contact | undefined
  onClose: () => void
  userName: string
}) {
  const { messages, loading } = useMessages(conv.orgId, conv.id)
  const sendMessage = useSendMessage(conv.orgId)
  const deleteConv = useDeleteConversation(conv.orgId)
  const toggleAI = useToggleConvAI(conv.orgId)
  const [text, setText] = useState('')
  const [showContactPanel, setShowContactPanel] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const t = text.trim()
    if (!t) return
    setText('')
    await sendMessage.mutateAsync({ convId: conv.id, text: t, senderName: userName, role: 'agent' })
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar esta conversación? Esta acción no se puede deshacer.')) return
    await deleteConv.mutateAsync(conv.id)
    onClose()
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Chat column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3 shrink-0 bg-gray-950/40 backdrop-blur-sm">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/8 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{
              background: `linear-gradient(135deg, ${PLATFORM_COLORS[conv.platform]}30, ${PLATFORM_COLORS[conv.platform]}10)`,
              border: `1px solid ${PLATFORM_COLORS[conv.platform]}30`,
              color: PLATFORM_COLORS[conv.platform],
            }}
          >
            {conv.contactName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{conv.contactName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs">{PLATFORM_ICONS[conv.platform]}</span>
              <span className="text-xs text-gray-500 capitalize">{conv.platform}</span>
              {conv.contactPhone && (
                <>
                  <span className="text-gray-700">·</span>
                  <span className="text-xs text-gray-500">{conv.contactPhone}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => toggleAI.mutate({ convId: conv.id, enabled: !conv.aiEnabled })}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                conv.aiEnabled
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/25 hover:bg-purple-600/30'
                  : 'text-gray-500 hover:bg-white/8 hover:text-gray-300',
              )}
            >
              {conv.aiEnabled ? <Bot size={13} /> : <BotOff size={13} />}
              {conv.aiEnabled ? 'IA activa' : 'IA'}
            </button>
            <button
              onClick={() => setShowContactPanel((v) => !v)}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                showContactPanel ? 'bg-white/8 text-gray-200' : 'text-gray-500 hover:bg-white/8 hover:text-gray-300',
              )}
            >
              <User size={14} />
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* AI banner */}
        {conv.aiEnabled && (
          <div className="bg-purple-900/20 border-b border-purple-500/15 px-4 py-2 text-xs text-purple-300 flex items-center gap-2 shrink-0">
            <Bot size={12} /> Agente IA respondiendo automáticamente
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <RefreshCw size={16} className="text-gray-600 animate-spin" />
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-60">
              <MessageSquare size={24} className="text-gray-700" />
              <p className="text-sm text-gray-600">Sin mensajes aún</p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-white/8 p-3 shrink-0 bg-gray-950/40">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 resize-none rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500/60 focus:border-brand-500/40 transition-all max-h-36 leading-relaxed"
              placeholder="Escribe un mensaje..."
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!text.trim() || sendMessage.isPending}
              loading={sendMessage.isPending}
            >
              <Send size={15} />
            </Button>
          </div>
          <p className="text-xs text-gray-700 mt-1.5 ml-1">Enter envía · Shift+Enter nueva línea</p>
        </div>
      </div>

      {/* Contact panel */}
      {showContactPanel && <ContactPanel contact={contact} conv={conv} />}
    </div>
  )
}

// ─── Conversation List Item ────────────────────────────────────────────────────

function ConvItem({
  conv,
  selected,
  onClick,
}: {
  conv: Conversation
  selected: boolean
  onClick: () => void
}) {
  const lastAt = toDate(conv.lastMessageAt)

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 px-3 py-3.5 rounded-xl text-left transition-all duration-150',
        selected
          ? 'bg-brand-600/15 border border-brand-500/20 shadow-sm'
          : 'hover:bg-white/[0.04] border border-transparent',
      )}
    >
      <div className="relative shrink-0 mt-0.5">
        <div
          className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            background: `linear-gradient(135deg, ${PLATFORM_COLORS[conv.platform]}25, ${PLATFORM_COLORS[conv.platform]}10)`,
            border: `1px solid ${PLATFORM_COLORS[conv.platform]}25`,
            color: PLATFORM_COLORS[conv.platform],
          }}
        >
          {conv.contactName.charAt(0).toUpperCase()}
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 text-[10px] leading-none rounded-full bg-gray-900 p-0.5">
          {PLATFORM_ICONS[conv.platform]}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-1">
          <p className={cn('text-sm font-semibold truncate', selected ? 'text-white' : 'text-gray-200')}>
            {conv.contactName}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {conv.aiEnabled && <Bot size={11} className="text-purple-400" />}
            {lastAt && <span className="text-xs text-gray-600">{formatTimeAgo(lastAt)}</span>}
          </div>
        </div>
        <p className="text-xs text-gray-600 truncate">{conv.lastMessage ?? 'Sin mensajes'}</p>
      </div>
    </button>
  )
}

// ─── Conversation List Sidebar ─────────────────────────────────────────────────

function ConversationList({
  conversations, isLoading, selectedConvId, onSelect, onNew, onRefetch,
}: {
  conversations: Conversation[]
  isLoading: boolean
  selectedConvId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRefetch: () => void
}) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  const filtered = conversations.filter((c) => {
    const matchesSearch =
      c.contactName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage?.toLowerCase().includes(search.toLowerCase())
    const matchesTab =
      activeTab === 'all' ? true
      : activeTab === 'ai' ? !!c.aiEnabled
      : c.platform === activeTab
    return matchesSearch && matchesTab
  })

  const TABS: { id: FilterTab; label: string; icon?: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'whatsapp', label: 'WA', icon: '📱' },
    { id: 'instagram', label: 'IG', icon: '📷' },
    { id: 'messenger', label: 'MSG', icon: '💬' },
    { id: 'ai', label: 'IA', icon: '🤖' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/8 shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Conversaciones</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onRefetch}
              className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-white/8 transition-colors"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <Button size="sm" onClick={onNew}>
              <Plus size={13} /> Nuevo
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-8 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-all"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1">
          {TABS.map((tab) => {
            const count =
              tab.id === 'all' ? conversations.length
              : tab.id === 'ai' ? conversations.filter((c) => c.aiEnabled).length
              : conversations.filter((c) => c.platform === tab.id).length
            if (tab.id !== 'all' && count === 0) return null
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                  activeTab === tab.id
                    ? 'bg-brand-600/20 text-brand-300 border border-brand-500/25'
                    : 'text-gray-600 hover:bg-white/5 hover:text-gray-300',
                )}
              >
                {tab.icon && <span>{tab.icon}</span>}
                {tab.label}
                {tab.id !== 'all' && count > 0 && (
                  <span className="bg-white/10 text-gray-400 text-[10px] px-1.5 rounded-full">{count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isLoading && (
          <div className="flex items-center justify-center py-16 gap-2 text-gray-600">
            <RefreshCw size={14} className="animate-spin" />
            <span className="text-sm">Cargando...</span>
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-60">
            <MessageSquare size={28} className="text-gray-700" />
            <p className="text-sm text-gray-600">
              {search || activeTab !== 'all' ? 'Sin resultados' : 'Sin conversaciones aún'}
            </p>
          </div>
        )}
        {filtered.map((conv) => (
          <ConvItem
            key={conv.id}
            conv={conv}
            selected={conv.id === selectedConvId}
            onClick={() => onSelect(conv.id)}
          />
        ))}
      </div>

      {/* Footer */}
      {!isLoading && conversations.length > 0 && (
        <div className="px-4 py-2.5 border-t border-white/8 shrink-0 flex items-center gap-3 text-xs text-gray-600">
          <span className="flex items-center gap-1"><Clock size={11} /> {filtered.length}</span>
          {conversations.some((c) => c.aiEnabled) && (
            <span className="flex items-center gap-1">
              <Bot size={11} className="text-purple-500" />
              {conversations.filter((c) => c.aiEnabled).length} con IA
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id
  const { data: conversations = [], isLoading, refetch } = useConversations(orgId)
  const { data: contacts = [] } = useContacts(orgId)
  const createConv = useCreateConversation(orgId)

  const [viewMode, setViewMode] = useState<ViewMode>('conversations')
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(false)

  const selectedConv = conversations.find((c) => c.id === selectedConvId) ?? null
  const selectedContact = selectedConv
    ? contacts.find((c) => c.id === selectedConv.contactId)
    : undefined

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-4 lg:-m-6 overflow-hidden">

      {/* Left: conversation list */}
      <div
        className={cn(
          'flex flex-col border-r border-white/8 bg-gray-950 shrink-0 transition-all duration-300',
          selectedConv
            ? 'w-72 xl:w-80 hidden lg:flex'
            : 'w-full lg:w-80 xl:w-96 flex',
        )}
      >
        {/* View mode switcher */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-0 shrink-0">
          <button
            onClick={() => setViewMode('conversations')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex-1 justify-center',
              viewMode === 'conversations'
                ? 'bg-brand-600/20 text-brand-300 border border-brand-500/20'
                : 'text-gray-600 hover:bg-white/5 hover:text-gray-400',
            )}
          >
            <List size={13} /> Lista
          </button>
          <button
            onClick={() => { setViewMode('funnel'); setSelectedConvId(null) }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex-1 justify-center',
              viewMode === 'funnel'
                ? 'bg-brand-600/20 text-brand-300 border border-brand-500/20'
                : 'text-gray-600 hover:bg-white/5 hover:text-gray-400',
            )}
          >
            <Kanban size={13} /> Funnel
          </button>
        </div>

        <ConversationList
          conversations={conversations}
          isLoading={isLoading}
          selectedConvId={selectedConvId}
          onSelect={(id) => {
            setSelectedConvId(id)
            setViewMode('conversations')
          }}
          onNew={() => setNewChatOpen(true)}
          onRefetch={() => refetch()}
        />
      </div>

      {/* Right: chat or funnel */}
      <div className="flex-1 flex overflow-hidden">
        {selectedConv ? (
          <ConversationPanel
            conv={selectedConv}
            contact={selectedContact}
            onClose={() => setSelectedConvId(null)}
            userName={userData?.name ?? 'Agente'}
          />
        ) : viewMode === 'funnel' ? (
          /* Full-page Funnel Kanban */
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-6 pt-5 pb-3 border-b border-white/8 shrink-0">
              <h2 className="text-lg font-semibold text-white">Funnel de Ventas</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Arrastra contactos entre etapas · {contacts.length} en total
              </p>
            </div>
            <div className="flex-1 overflow-x-auto overflow-y-auto p-6">
              <FunnelView
                contacts={contacts}
                orgId={orgId}
                onOpenConversation={(contactId) => {
                  const conv = conversations.find((c) => c.contactId === contactId)
                  if (conv) {
                    setSelectedConvId(conv.id)
                    setViewMode('conversations')
                  } else {
                    toast.info('Sin conversación activa para este contacto')
                  }
                }}
              />
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="hidden lg:flex flex-1 flex-col items-center justify-center gap-5 text-center px-8">
            <div className="h-20 w-20 rounded-2xl bg-brand-600/10 border border-brand-500/15 flex items-center justify-center">
              <MessageSquare size={36} className="text-brand-500/50" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-300">Selecciona una conversación</p>
              <p className="text-sm text-gray-600 mt-1.5 max-w-sm">
                Elige una de la lista o crea una nueva para comenzar a chatear
              </p>
            </div>
            <Button variant="outline" onClick={() => setNewChatOpen(true)}>
              <Plus size={14} /> Nueva conversación
            </Button>
          </div>
        )}
      </div>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        contacts={contacts}
        orgId={orgId}
        userName={userData?.name ?? 'Agente'}
        onCreate={async (data) => {
          await createConv.mutateAsync(data)
          setNewChatOpen(false)
        }}
        isCreating={createConv.isPending}
      />
    </div>
  )
}
