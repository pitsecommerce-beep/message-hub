import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Bot, Plus, Pencil, Trash2, TestTube2, Send, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import {
  useAIAgents,
  useSaveAIAgent,
  useDeleteAIAgent,
} from '@/features/config/hooks/use-config'
import { useKnowledgeBases } from '@/features/knowledge-base/hooks/use-knowledge-base'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AIAgent, AIProvider, Platform } from '@/types'

const MODELS: Record<AIProvider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  custom: [],
}

const agentSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  provider: z.enum(['openai', 'anthropic', 'custom']),
  model: z.string().min(1, 'Modelo requerido'),
  // Optional when editing (empty = keep existing key); required only on create
  apiKey: z.string().optional(),
  endpoint: z.string().optional(),
  systemPrompt: z.string().min(10, 'El system prompt debe tener al menos 10 caracteres'),
  knowledgeBases: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  active: z.boolean(),
})

type AgentForm = z.infer<typeof agentSchema>

// ─── Agent test dialog ─────────────────────────────────────────────────────────

interface TestMessage {
  role: 'user' | 'assistant'
  content: string
}

function AgentTestDialog({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  agent: AIAgent
}) {
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apiKey = (agent as AIAgent & { apiKey?: string }).apiKey ?? ''

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setError(null)
    const newMessages: TestMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setLoading(true)
    try {
      let reply = ''
      if (agent.provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: agent.model,
            messages: [
              { role: 'system', content: agent.systemPrompt },
              ...newMessages.map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.error?.message ?? `Error ${res.status}`)
        }
        const data = await res.json()
        reply = data.choices?.[0]?.message?.content ?? ''
      } else if (agent.provider === 'anthropic') {
        const endpoint = (agent as AIAgent & { endpoint?: string }).endpoint
          || 'https://api.anthropic.com/v1/messages'
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: agent.model,
            system: agent.systemPrompt,
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
            max_tokens: 1024,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.error?.message ?? `Error ${res.status}`)
        }
        const data = await res.json()
        reply = data.content?.[0]?.text ?? ''
      } else {
        // Custom provider
        const endpoint = (agent as AIAgent & { endpoint?: string }).endpoint
        if (!endpoint) throw new Error('El proveedor personalizado requiere un endpoint')
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: agent.model,
            messages: [
              { role: 'system', content: agent.systemPrompt },
              ...newMessages.map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
        })
        if (!res.ok) throw new Error(`Error ${res.status}`)
        const data = await res.json()
        reply = data.choices?.[0]?.message?.content ?? data.content?.[0]?.text ?? ''
      }
      setMessages([...newMessages, { role: 'assistant', content: reply }])
    } catch (err: unknown) {
      setError((err as Error).message)
      // Revert optimistic user message on error
      setMessages(messages)
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    onOpenChange(false)
    setMessages([])
    setInput('')
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) { onOpenChange(o); if (!o) handleClose() } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TestTube2 size={16} className="text-purple-400" />
            Probar Agente — {agent.name}
          </DialogTitle>
        </DialogHeader>

        {/* System prompt preview */}
        <div className="rounded-xl bg-purple-900/15 border border-purple-500/20 px-4 py-3">
          <p className="text-xs font-semibold text-purple-400 mb-1">System Prompt</p>
          <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">{agent.systemPrompt}</p>
        </div>

        {/* Chat messages */}
        <div className="h-64 overflow-y-auto space-y-3 rounded-xl border border-white/8 bg-black/20 p-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-sm text-gray-600">
              Escribe un mensaje para probar el agente
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                  msg.role === 'user'
                    ? 'bg-brand-600 text-white rounded-br-md'
                    : 'bg-purple-700/60 text-gray-100 border border-purple-500/20 rounded-bl-md'
                }`}
              >
                {msg.role === 'assistant' && (
                  <p className="text-xs text-purple-300 mb-1 font-semibold flex items-center gap-1">
                    <Bot size={10} /> {agent.name}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-purple-700/40 border border-purple-500/20 rounded-2xl rounded-bl-md px-4 py-3">
                <RefreshCw size={14} className="text-purple-400 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Escribe tu mensaje de prueba..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            disabled={loading}
          />
          <Button onClick={sendMessage} disabled={!input.trim() || loading} loading={loading}>
            <Send size={14} />
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Agent create/edit dialog ──────────────────────────────────────────────────

function AgentDialog({
  open,
  onOpenChange,
  agent,
  orgId,
  kbs,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  agent: AIAgent | null
  orgId: string | undefined
  kbs: { id: string; name: string }[]
}) {
  const saveAgent = useSaveAIAgent(orgId)

  function buildDefaultValues(a: AIAgent | null): AgentForm {
    return a
      ? {
          name: a.name,
          provider: a.provider,
          model: a.model,
          apiKey: '',           // Never pre-fill the stored key for security
          endpoint: a.endpoint ?? '',
          systemPrompt: a.systemPrompt,
          knowledgeBases: a.knowledgeBases ?? [],
          channels: a.channels ?? [],
          active: a.active,
        }
      : { provider: 'openai', active: true, knowledgeBases: [], channels: [] }
  }

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
    defaultValues: buildDefaultValues(agent),
  })

  // Re-populate form whenever the dialog opens or the target agent changes
  useEffect(() => {
    reset(buildDefaultValues(agent))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent?.id])

  const provider = watch('provider')
  const selectedKBs = watch('knowledgeBases') ?? []
  const selectedChannels = watch('channels') ?? []

  async function onSubmit(data: AgentForm) {
    if (!orgId) return
    // When creating a new agent the API key is mandatory
    if (!agent && !data.apiKey?.trim()) {
      setError('apiKey', { message: 'API Key requerida' })
      return
    }
    await saveAgent.mutateAsync({
      id: agent?.id,
      ...data,
      provider: data.provider as AIProvider,
      channels: data.channels as Platform[],
      orgId,
    })
    onOpenChange(false)
    reset()
  }

  const channels: { value: Platform; label: string; icon: string }[] = [
    { value: 'whatsapp', label: 'WhatsApp', icon: '📱' },
    { value: 'instagram', label: 'Instagram', icon: '📷' },
    { value: 'messenger', label: 'Messenger', icon: '💬' },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saveAgent.isPending) { onOpenChange(o); reset() } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agent ? 'Editar Agente' : 'Crear Agente IA'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre del agente *</Label>
              <Input placeholder="Agente de Ventas..." {...register('name')} />
              {errors.name && <p className="text-xs text-red-400">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Proveedor *</Label>
              <Controller
                name="provider"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                      <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                      <SelectItem value="custom">Personalizado</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Modelo *</Label>
              {provider === 'custom' ? (
                <Input placeholder="nombre-del-modelo" {...register('model')} />
              ) : (
                <Controller
                  name="model"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar modelo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(MODELS[provider as AIProvider] ?? []).map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
              {errors.model && <p className="text-xs text-red-400">{errors.model.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>{agent ? 'API Key' : 'API Key *'}</Label>
              <Input
                type="password"
                placeholder={agent ? 'Dejar vacío para mantener la actual' : 'sk-...'}
                {...register('apiKey')}
              />
              {errors.apiKey && <p className="text-xs text-red-400">{errors.apiKey.message}</p>}
            </div>
          </div>

          {provider === 'custom' && (
            <div className="space-y-1.5">
              <Label>URL del Endpoint</Label>
              <Input placeholder="https://api.custom.com/v1/chat/completions" {...register('endpoint')} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>System Prompt *</Label>
            <Textarea
              rows={4}
              placeholder="Eres un agente de atención al cliente amable..."
              {...register('systemPrompt')}
            />
            {errors.systemPrompt && <p className="text-xs text-red-400">{errors.systemPrompt.message}</p>}
          </div>

          {/* Knowledge Bases */}
          {kbs.length > 0 && (
            <div className="space-y-1.5">
              <Label>Bases de datos asignadas</Label>
              <Controller
                name="knowledgeBases"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2">
                    {kbs.map((kb) => {
                      const selected = field.value?.includes(kb.id) ?? false
                      return (
                        <button
                          key={kb.id}
                          type="button"
                          onClick={() => {
                            const curr = field.value ?? []
                            field.onChange(
                              selected ? curr.filter((id) => id !== kb.id) : [...curr, kb.id],
                            )
                          }}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                            selected
                              ? 'border-brand-500 bg-brand-600/15 text-brand-300'
                              : 'border-white/15 text-gray-400 hover:bg-white/5'
                          }`}
                        >
                          {kb.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              />
            </div>
          )}

          {/* Channels */}
          <div className="space-y-1.5">
            <Label>Canales</Label>
            <Controller
              name="channels"
              control={control}
              render={({ field }) => (
                <div className="flex gap-2">
                  {channels.map((ch) => {
                    const selected = field.value?.includes(ch.value) ?? false
                    return (
                      <button
                        key={ch.value}
                        type="button"
                        onClick={() => {
                          const curr = field.value ?? []
                          field.onChange(
                            selected ? curr.filter((c) => c !== ch.value) : [...curr, ch.value],
                          )
                        }}
                        className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-colors ${
                          selected
                            ? 'border-brand-500 bg-brand-600/15 text-brand-300'
                            : 'border-white/15 text-gray-400 hover:bg-white/5'
                        }`}
                      >
                        {ch.icon} {ch.label}
                      </button>
                    )
                  })}
                </div>
              )}
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <Controller
              name="active"
              control={control}
              render={({ field }) => (
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  id="active-switch"
                />
              )}
            />
            <Label htmlFor="active-switch">Agente activo</Label>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); reset() }} disabled={saveAgent.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={saveAgent.isPending}>
            {agent ? 'Guardar Cambios' : 'Crear Agente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id

  const { data: agents = [], isLoading } = useAIAgents(orgId)
  const { data: kbs = [] } = useKnowledgeBases(orgId)
  const deleteAgent = useDeleteAIAgent(orgId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null)
  const [testingAgent, setTestingAgent] = useState<AIAgent | null>(null)

  function openCreate() {
    setEditingAgent(null)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{agents.length} agentes configurados</p>
        <Button onClick={openCreate}>
          <Plus size={14} /> Crear Agente
        </Button>
      </div>

      {isLoading && <div className="py-16 text-center text-gray-600 animate-pulse">Cargando...</div>}

      {!isLoading && agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Bot size={48} className="text-gray-700" />
          <div className="text-center">
            <p className="font-medium text-gray-400">Sin agentes IA</p>
            <p className="text-sm text-gray-600 mt-1">
              Crea un agente para automatizar respuestas en tus canales de mensajería
            </p>
          </div>
          <Button onClick={openCreate}><Plus size={14} /> Crear primer agente</Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <div key={agent.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 hover:border-white/20 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-purple-600/15 flex items-center justify-center">
                  <Bot size={18} className="text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-white text-sm">{agent.name}</p>
                  <p className="text-xs text-gray-500">{agent.provider} · {agent.model}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Probar agente"
                  className="text-purple-400 hover:text-purple-300 hover:bg-purple-600/10"
                  onClick={() => setTestingAgent(agent)}
                >
                  <TestTube2 size={13} />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => { setEditingAgent(agent); setDialogOpen(true) }}>
                  <Pencil size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-gray-500 hover:text-red-400"
                  onClick={() => {
                    if (confirm(`¿Eliminar "${agent.name}"?`)) deleteAgent.mutate(agent.id)
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>

            <p className="text-xs text-gray-500 line-clamp-2">{agent.systemPrompt}</p>

            <div className="flex flex-wrap gap-1.5">
              <Badge variant={agent.active ? 'success' : 'secondary'}>
                {agent.active ? 'Activo' : 'Inactivo'}
              </Badge>
              {(agent.channels ?? []).map((ch) => (
                <Badge key={ch} variant="secondary">
                  {ch === 'whatsapp' ? '📱' : ch === 'instagram' ? '📷' : '💬'} {ch}
                </Badge>
              ))}
            </div>

            {/* Test button visible in card footer */}
            <button
              onClick={() => setTestingAgent(agent)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-purple-500/20 text-xs text-purple-400 hover:bg-purple-600/10 transition-colors"
            >
              <TestTube2 size={12} /> Probar agente
            </button>
          </div>
        ))}
      </div>

      <AgentDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingAgent(null) }}
        agent={editingAgent}
        orgId={orgId}
        kbs={kbs}
      />

      {testingAgent && (
        <AgentTestDialog
          open={!!testingAgent}
          onOpenChange={(o) => { if (!o) setTestingAgent(null) }}
          agent={testingAgent}
        />
      )}
    </div>
  )
}
