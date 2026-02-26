import { useState, useEffect, useRef } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Bot, Plus, Pencil, Trash2, TestTube2, Send, RefreshCw, Database } from 'lucide-react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db as firestoreDb } from '@/lib/firebase'
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

// ─── Agent test dialog (with KB data + tools + multi-turn) ───────────────────

interface TestMessage {
  role: 'user' | 'assistant'
  content: string
}

interface KBCache {
  name: string
  columns: string[]
  rows: Record<string, unknown>[]
}

// ── Helpers (local, no server needed) ────────────────────────────────────────

function cleanTestResponse(text: string): string {
  if (!text) return text
  let c = text
  c = c.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  c = c.replace(/<invoke[\s\S]*?<\/invoke>/gi, '')
  c = c.replace(/<invoke[\s\S]*?<\/antml:invoke>/gi, '')
  c = c.replace(/<parameter[\s\S]*?<\/parameter>/gi, '')
  c = c.replace(/<\/?(function_calls|invoke|parameter|antml:invoke)[^>]*>/gi, '')
  c = c.replace(/```[a-z]*\n?[\s\S]*?```/g, (m) =>
    /invoke|function_call|query_database|save_contact|create_order|<parameter/i.test(m) ? '' : m)
  const narr = [
    /[Dd]éjame\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
    /[Vv]oy\s+a\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
    /[Pp]ermíteme\s+(consultar|verificar|revisar|buscar|checar)\w*\s*[^.!?\n]*[.…]{0,3}\s*/g,
    /[Cc]onsultando\s+(en\s+)?(el\s+)?(sistema|inventario|base\s+de\s+datos)[^.!?\n]*[.…]{0,3}\s*/g,
    /[Bb]uscando\s+(en\s+)?(el\s+)?(sistema|inventario|base\s+de\s+datos|catálogo)[^.!?\n]*[.…*]{0,5}\s*/g,
    /[Ll]isto,?\s*déjame\s+revisar\s+[^.!?\n]*[.…]{0,3}\s*/g,
    /[Uu]n\s+momento\s+(mientras|que)\s+(consulto|verifico|reviso|busco)[^.!?\n]*[.…]{0,3}\s*/g,
    /🔍[^.!?\n]*[.…*]{0,5}\s*/g,
  ]
  for (const p of narr) c = c.replace(p, '')
  return c.replace(/\n{3,}/g, '\n\n').trim()
}

function buildEnrichedPrompt(agent: AIAgent, kbCache: Map<string, KBCache>): string {
  let prompt = agent.systemPrompt || ''

  prompt += '\n\n---\nREGLAS DE FORMATO DE RESPUESTA (obligatorias):\n'
  prompt += '- Responde SIEMPRE de forma directa con la información. NUNCA narres el proceso interno.\n'
  prompt += '- NUNCA incluyas XML, JSON, etiquetas, bloques de código ni sintaxis técnica.\n'
  prompt += '- NUNCA muestres nombres de herramientas internas al cliente.\n'
  prompt += '- Si ya tienes la información, preséntala de inmediato SIN hacer preguntas adicionales.\n'
  prompt += '- Solo pregunta datos GENUINAMENTE necesarios que NO puedas inferir del contexto.\n'
  prompt += '- Sé conciso y directo.\n'
  prompt += '- NUNCA inventes precios ni datos.\n'
  prompt += '- NUNCA digas que no tienes acceso a la base de datos. SIEMPRE tienes acceso — usa query_database.\n\n'

  prompt += 'USO DE HERRAMIENTAS:\n'
  prompt += '- Las herramientas se ejecutan automáticamente.\n'
  prompt += '- save_contact: Cuando el cliente mencione su nombre o empresa.\n'
  prompt += '- create_order: Cuando el cliente confirme un pedido.\n'
  if (kbCache.size > 0) {
    prompt += '- query_database: Para buscar productos que NO estén en los datos de referencia.\n'
  }
  prompt += '\n'

  if (kbCache.size === 0) return prompt

  prompt += '=== DATOS DE REFERENCIA (muestra del inventario) ===\n'
  prompt += 'Usa estos datos para responder. Si el producto NO aparece aquí, llama a query_database.\n\n'

  for (const [, kb] of kbCache) {
    prompt += `--- ${kb.name.toUpperCase()} ---\n`
    prompt += `Columnas: ${kb.columns.join(' | ')}\n\n`
    const slice = kb.rows.slice(0, 15)
    prompt += `Mostrando ${slice.length} de ${kb.rows.length} registros:\n\n`
    slice.forEach((row, i) => {
      const parts = kb.columns.map((col) => `${col}: ${row[col] ?? ''}`)
      prompt += `${i + 1}. ${parts.join(' | ')}\n`
    })
    prompt += '\n'
  }

  prompt += '=== FIN DE DATOS ===\n\n'
  prompt += 'CÓMO USAR LOS DATOS:\n'
  prompt += '- Si el producto aparece arriba → úsalo directamente.\n'
  prompt += '- Si NO aparece → llama a query_database.\n'
  prompt += '- NUNCA digas "no tenemos esa pieza" sin antes buscar con query_database.\n'

  return prompt
}

function buildTestTools(agent: AIAgent, hasKBs: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'save_contact',
        description: 'Registra o actualiza los datos del cliente en el CRM.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre completo' },
            company: { type: 'string', description: 'Empresa o taller' },
            phone: { type: 'string' }, email: { type: 'string' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_order',
        description: 'Crea un pedido cuando el cliente confirma productos.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product: { type: 'string' }, sku: { type: 'string' },
                  quantity: { type: 'number' }, unitPrice: { type: 'number' },
                },
                required: ['product', 'quantity'],
              },
            },
          },
          required: ['items'],
        },
      },
    },
  ]

  if (hasKBs) {
    tools.push({
      type: 'function',
      function: {
        name: 'query_database',
        description: 'Consulta el inventario de productos. Pasa los filtros disponibles.',
        parameters: {
          type: 'object',
          properties: {
            searchQuery: { type: 'string', description: 'Búsqueda libre' },
            marca: { type: 'string' }, modelo: { type: 'string' },
            parte: { type: 'string' }, año: { type: 'number' },
            lado: { type: 'string' }, del_tras: { type: 'string' },
            int_ext: { type: 'string' }, limit: { type: 'number' },
          },
          required: [],
        },
      },
    })
  }

  return tools
}

function executeLocalQuery(params: Record<string, unknown>, kbCache: Map<string, KBCache>): string {
  const allRows: { row: Record<string, unknown>; columns: string[] }[] = []
  for (const [, kb] of kbCache) {
    for (const row of kb.rows) allRows.push({ row, columns: kb.columns })
  }
  if (allRows.length === 0) return 'No hay productos en la base de datos.'

  const searchTerms = [
    params.searchQuery, params.marca, params.modelo,
    params.parte, params.año != null ? String(params.año) : null,
    params.lado, params.del_tras, params.int_ext,
  ].filter((s): s is string => !!s).map((s) => String(s).toLowerCase())

  if (searchTerms.length === 0) return 'Especifica al menos un criterio de búsqueda.'

  const scored = allRows.map(({ row, columns }) => {
    const rowText = columns.map((c) => String(row[c] ?? '')).join(' ').toLowerCase()
    let score = 0
    for (const term of searchTerms) { if (rowText.includes(term)) score++ }
    return { row, columns, score }
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score)

  const limit = Math.min(Number(params.limit) || 25, 50)
  const results = scored.slice(0, limit)
  if (results.length === 0) return 'No se encontraron productos con los criterios especificados.'

  const cols = results[0].columns
  const formatted = results.map(({ row }, i) =>
    `${i + 1}. ${cols.map((col) => `${col}: ${row[col] ?? ''}`).join(' | ')}`
  ).join('\n')
  return `Resultados (${results.length}):\n${formatted}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function executeTestTool(name: string, params: any, kbCache: Map<string, KBCache>): string {
  if (name === 'query_database') return executeLocalQuery(params, kbCache)
  if (name === 'save_contact') return `Contacto registrado: ${params.name || 'Cliente'}`
  if (name === 'create_order') return `Pedido registrado con ${(params.items || []).length} producto(s).`
  return 'OK'
}

// ── Main test dialog component ───────────────────────────────────────────────

function AgentTestDialog({
  open,
  onOpenChange,
  agent,
  orgId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  agent: AIAgent
  orgId: string | undefined
}) {
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kbCache, setKbCache] = useState<Map<string, KBCache>>(new Map())
  const [kbLoading, setKbLoading] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const apiKey = (agent as AIAgent & { apiKey?: string }).apiKey ?? ''

  // Load KB data when dialog opens
  useEffect(() => {
    if (!open || !orgId) return
    const kbIds = agent.knowledgeBases ?? []
    if (kbIds.length === 0) { setKbCache(new Map()); return }

    let cancelled = false
    setKbLoading(true)

    async function load() {
      const cache = new Map<string, KBCache>()
      for (const kbId of kbIds) {
        try {
          const metaSnap = await getDoc(doc(firestoreDb, 'knowledgeBases', kbId))
          if (!metaSnap.exists()) continue
          const meta = metaSnap.data()
          const rowsSnap = await getDocs(collection(firestoreDb, 'knowledgeBases', kbId, 'rows'))
          const rows = rowsSnap.docs.map((d) => d.data())
          cache.set(kbId, {
            name: meta.name || kbId,
            columns: meta.columns || Object.keys(rows[0] || {}).filter((k) => k !== '_rowIndex'),
            rows,
          })
        } catch (err) { console.error(`Error loading KB ${kbId}:`, err) }
      }
      if (!cancelled) { setKbCache(cache); setKbLoading(false) }
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent.id])

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, loading])

  // ── Multi-turn send with tool handling ──────────────────────────────────

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setError(null)
    const newMessages: TestMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const systemPrompt = buildEnrichedPrompt(agent, kbCache)
      const tools = buildTestTools(agent, kbCache.size > 0)
      let reply: string

      if (agent.provider === 'anthropic') {
        reply = await callAnthropicMultiTurn(agent, apiKey, systemPrompt, newMessages, tools, kbCache)
      } else {
        reply = await callOpenAIMultiTurn(agent, apiKey, systemPrompt, newMessages, tools, kbCache)
      }

      setMessages([...newMessages, { role: 'assistant', content: reply }])
    } catch (err: unknown) {
      setError((err as Error).message)
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

  const kbCount = kbCache.size
  const totalRows = [...kbCache.values()].reduce((s, kb) => s + kb.rows.length, 0)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) { onOpenChange(o); if (!o) handleClose() } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TestTube2 size={16} className="text-purple-400" />
            Probar Agente — {agent.name}
          </DialogTitle>
        </DialogHeader>

        {/* System prompt + KB status */}
        <div className="rounded-xl bg-purple-900/15 border border-purple-500/20 px-4 py-3">
          <p className="text-xs font-semibold text-purple-400 mb-1">System Prompt</p>
          <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">{agent.systemPrompt}</p>
          {kbLoading ? (
            <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" /> Cargando bases de datos...
            </p>
          ) : kbCount > 0 ? (
            <p className="text-xs text-green-400 mt-2 flex items-center gap-1">
              <Database size={10} /> {kbCount} base(s) cargada(s) — {totalRows} productos disponibles
            </p>
          ) : (agent.knowledgeBases?.length ?? 0) > 0 ? (
            <p className="text-xs text-yellow-400 mt-2">Sin datos de KB cargados</p>
          ) : null}
        </div>

        {/* Chat messages */}
        <div ref={chatRef} className="h-64 overflow-y-auto space-y-3 rounded-xl border border-white/8 bg-black/20 p-4">
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
            disabled={loading || kbLoading}
          />
          <Button onClick={sendMessage} disabled={!input.trim() || loading || kbLoading} loading={loading}>
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

// ── Multi-turn API callers (with tool execution) ─────────────────────────────

async function callOpenAIMultiTurn(
  agent: AIAgent, apiKey: string, systemPrompt: string,
  chatMessages: TestMessage[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[], kbCache: Map<string, KBCache>,
): Promise<string> {
  const endpoint = (agent.provider === 'custom' && (agent as AIAgent & { endpoint?: string }).endpoint)
    ? (agent as AIAgent & { endpoint?: string }).endpoint!
    : 'https://api.openai.com/v1/chat/completions'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history: any[] = [
    { role: 'system', content: systemPrompt },
    ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
  ]

  for (let round = 0; round < 5; round++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = { model: agent.model, messages: history, max_tokens: 2048, temperature: 0.7 }
    if (tools.length > 0) body.tools = tools

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `Error ${res.status}`)
    }

    const data = await res.json()
    const choice = data.choices?.[0]

    // Native tool calls
    if (choice?.finish_reason === 'tool_calls' || choice?.message?.tool_calls?.length) {
      const toolResults = (choice.message.tool_calls || []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tc: any) => {
          const args = JSON.parse(tc.function.arguments)
          return { role: 'tool' as const, tool_call_id: tc.id, content: executeTestTool(tc.function.name, args, kbCache) }
        },
      )
      history.push(choice.message)
      history.push(...toolResults)
      continue
    }

    return cleanTestResponse(choice?.message?.content || '')
  }
  return ''
}

async function callAnthropicMultiTurn(
  agent: AIAgent, apiKey: string, systemPrompt: string,
  chatMessages: TestMessage[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[], kbCache: Map<string, KBCache>,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history: any[] = chatMessages.map((m) => ({ role: m.role, content: m.content }))
  const anthropicTools = tools.map((t: { function: { name: string; description: string; parameters: unknown } }) => ({
    name: t.function.name, description: t.function.description, input_schema: t.function.parameters,
  }))

  for (let round = 0; round < 5; round++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      model: agent.model, max_tokens: 2048, system: systemPrompt, messages: history,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': apiKey,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `Error ${res.status}`)
    }

    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUseBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use')

    if (toolUseBlocks.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = toolUseBlocks.map((tb: any) => ({
        type: 'tool_result' as const, tool_use_id: tb.id,
        content: executeTestTool(tb.name, tb.input, kbCache),
      }))
      history.push({ role: 'assistant', content: data.content })
      history.push({ role: 'user', content: results })
      continue
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlock = (data.content || []).find((b: any) => b.type === 'text')
    return cleanTestResponse(textBlock?.text || '')
  }
  return ''
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
      : { name: '', provider: 'openai', model: '', systemPrompt: '', active: true, knowledgeBases: [], channels: [] }
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
          orgId={orgId}
        />
      )}
    </div>
  )
}
