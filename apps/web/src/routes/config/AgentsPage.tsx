import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Bot, Plus, Pencil, Trash2, TestTube2 } from 'lucide-react'
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
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-3-5'],
  custom: [],
}

const agentSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  provider: z.enum(['openai', 'anthropic', 'custom']),
  model: z.string().min(1, 'Modelo requerido'),
  apiKey: z.string().min(1, 'API Key requerida'),
  endpoint: z.string().optional(),
  systemPrompt: z.string().min(10, 'El system prompt debe tener al menos 10 caracteres'),
  knowledgeBases: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  active: z.boolean(),
})

type AgentForm = z.infer<typeof agentSchema>

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
  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
    defaultValues: agent
      ? {
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          apiKey: '',
          endpoint: agent.endpoint ?? '',
          systemPrompt: agent.systemPrompt,
          knowledgeBases: agent.knowledgeBases ?? [],
          channels: agent.channels ?? [],
          active: agent.active,
        }
      : { provider: 'openai', active: true, knowledgeBases: [], channels: [] },
  })

  const provider = watch('provider')
  const selectedKBs = watch('knowledgeBases') ?? []
  const selectedChannels = watch('channels') ?? []

  async function onSubmit(data: AgentForm) {
    if (!orgId) return
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
              <Label>API Key *</Label>
              <Input type="password" placeholder="sk-..." {...register('apiKey')} />
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

export default function AgentsPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id

  const { data: agents = [], isLoading } = useAIAgents(orgId)
  const { data: kbs = [] } = useKnowledgeBases(orgId)
  const deleteAgent = useDeleteAIAgent(orgId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null)

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
    </div>
  )
}
