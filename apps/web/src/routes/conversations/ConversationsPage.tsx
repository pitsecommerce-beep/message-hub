import { useState, useRef, useEffect } from 'react'
import { MessageSquare, Plus, Bot, BotOff, Trash2, ChevronRight, Send, X } from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatTimeAgo } from '@/lib/utils'
import type { Conversation, Platform } from '@/types'
import FunnelView from './FunnelView'
import NewChatDialog from './NewChatDialog'

const PLATFORM_ICONS: Record<Platform, string> = {
  whatsapp: '📱',
  instagram: '📷',
  messenger: '💬',
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: { id: string; text: string; role: string; senderName?: string; timestamp?: unknown } }) {
  const isAgent = msg.role === 'agent' || msg.role === 'ai'
  return (
    <div className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm',
          isAgent
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-white/10 text-gray-100 rounded-bl-sm',
          msg.role === 'ai' && 'bg-purple-600/80',
        )}
      >
        {msg.role === 'ai' && (
          <p className="text-xs text-purple-200 mb-1 font-medium">🤖 Agente IA</p>
        )}
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        <p className={cn('text-xs mt-1', isAgent ? 'text-white/60' : 'text-gray-500')}>
          {formatTimeAgo(toDate(msg.timestamp))}
        </p>
      </div>
    </div>
  )
}

// ─── Conversation Panel ────────────────────────────────────────────────────────

function ConversationPanel({
  conv,
  onClose,
  userName,
}: {
  conv: Conversation
  onClose: () => void
  userName: string
}) {
  const orgId = conv.orgId
  const { messages, loading } = useMessages(conv.id)
  const sendMessage = useSendMessage()
  const deleteConv = useDeleteConversation(orgId)
  const toggleAI = useToggleConvAI(orgId)
  const [text, setText] = useState('')
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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3 shrink-0">
        <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-white lg:hidden">
          <ChevronRight size={16} />
        </button>
        <div className="h-8 w-8 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 text-sm font-semibold shrink-0">
          {conv.contactName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{conv.contactName}</p>
          <p className="text-xs text-gray-500">
            {PLATFORM_ICONS[conv.platform]} {conv.platform}
            {conv.contactPhone ? ` · ${conv.contactPhone}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title={conv.aiEnabled ? 'Desactivar IA' : 'Activar IA'}
            onClick={() => toggleAI.mutate({ convId: conv.id, enabled: !conv.aiEnabled })}
            className={conv.aiEnabled ? 'text-purple-400' : 'text-gray-500'}
          >
            {conv.aiEnabled ? <Bot size={15} /> : <BotOff size={15} />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-gray-500 hover:text-red-400"
            onClick={handleDelete}
          >
            <Trash2 size={14} />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-gray-500 lg:hidden" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* AI badge */}
      {conv.aiEnabled && (
        <div className="bg-purple-600/10 border-b border-purple-500/20 px-4 py-2 text-xs text-purple-300 flex items-center gap-2">
          <Bot size={12} />
          Agente IA activo en esta conversación
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <p className="text-sm text-gray-600 text-center">Cargando mensajes...</p>}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
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
      <div className="border-t border-white/8 p-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent max-h-32"
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
      </div>
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
        'w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition-colors',
        selected ? 'bg-brand-600/20' : 'hover:bg-white/5',
      )}
    >
      <div className="h-9 w-9 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 text-sm font-semibold shrink-0 mt-0.5">
        {conv.contactName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className={cn('text-sm font-medium truncate', selected ? 'text-white' : 'text-gray-200')}>
            {conv.contactName}
          </p>
          {lastAt && <span className="text-xs text-gray-600 shrink-0">{formatTimeAgo(lastAt)}</span>}
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {PLATFORM_ICONS[conv.platform]} {conv.lastMessage ?? 'Sin mensajes'}
        </p>
      </div>
      {conv.aiEnabled && (
        <Bot size={12} className="text-purple-400 mt-1 shrink-0" />
      )}
    </button>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id
  const { data: conversations = [], isLoading } = useConversations(orgId)
  const { data: contacts = [] } = useContacts(orgId)
  const createConv = useCreateConversation(orgId)

  const [view, setView] = useState<'list' | 'funnel'>('list')
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [newChatOpen, setNewChatOpen] = useState(false)

  const selectedConv = conversations.find((c) => c.id === selectedConvId) ?? null

  const filtered = conversations.filter(
    (c) =>
      c.contactName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage?.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-4 lg:-m-6 overflow-hidden">
      {/* Left panel */}
      <div
        className={cn(
          'flex flex-col border-r border-white/8 bg-gray-950',
          'w-full lg:w-80 xl:w-96 shrink-0',
          selectedConv ? 'hidden lg:flex' : 'flex',
        )}
      >
        {/* Header */}
        <div className="p-3 border-b border-white/8 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'funnel')}>
              <TabsList>
                <TabsTrigger value="list">Lista</TabsTrigger>
                <TabsTrigger value="funnel">Funnel</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button size="sm" onClick={() => setNewChatOpen(true)}>
              <Plus size={13} /> Nuevo
            </Button>
          </div>
          <input
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            placeholder="Buscar conversación..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {view === 'list' && (
            <>
              {isLoading && (
                <p className="text-sm text-gray-600 text-center py-8 animate-pulse">
                  Cargando...
                </p>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <MessageSquare size={32} className="text-gray-700" />
                  <p className="text-sm text-gray-600">
                    {search ? 'Sin resultados' : 'Sin conversaciones aún'}
                  </p>
                </div>
              )}
              {filtered.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  selected={conv.id === selectedConvId}
                  onClick={() => setSelectedConvId(conv.id)}
                />
              ))}
            </>
          )}
          {view === 'funnel' && (
            <FunnelView
              contacts={contacts}
              orgId={orgId}
              onOpenConversation={(contactId) => {
                const conv = conversations.find((c) => c.contactId === contactId)
                if (conv) setSelectedConvId(conv.id)
                else toast.info('Sin conversación activa para este contacto')
                setView('list')
              }}
            />
          )}
        </div>
      </div>

      {/* Right panel */}
      <div
        className={cn(
          'flex-1 overflow-hidden',
          selectedConv ? 'flex flex-col' : 'hidden lg:flex lg:flex-col',
        )}
      >
        {selectedConv ? (
          <ConversationPanel
            conv={selectedConv}
            onClose={() => setSelectedConvId(null)}
            userName={userData?.name ?? 'Agente'}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
            <MessageSquare size={48} className="text-gray-700" />
            <div>
              <p className="font-medium text-gray-400">Selecciona una conversación</p>
              <p className="text-sm text-gray-600 mt-1">Elige una de la lista para ver los mensajes</p>
            </div>
          </div>
        )}
      </div>

      {/* New Chat Dialog */}
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
