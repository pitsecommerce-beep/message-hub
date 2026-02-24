import { z } from 'zod'

// ─── Platform ────────────────────────────────────────────────────────────────
export const PlatformSchema = z.enum(['whatsapp', 'instagram', 'messenger'])
export type Platform = z.infer<typeof PlatformSchema>

// ─── Funnel ───────────────────────────────────────────────────────────────────
export const FUNNEL_STAGES = [
  'Curioso',
  'Cotizando',
  'Pago Pendiente',
  'Orden Pendiente',
  'Entregado',
  'Atención Inmediata',
] as const
export type FunnelStage = (typeof FUNNEL_STAGES)[number]

// ─── Conversation ─────────────────────────────────────────────────────────────
export const ConversationSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  contactName: z.string(),
  contactPhone: z.string().optional(),
  platform: PlatformSchema,
  status: z.enum(['open', 'closed']),
  funnelStage: z.string(),
  aiEnabled: z.boolean(),
  lastMessage: z.string().optional(),
  lastMessageAt: z.coerce.date(),
  unreadCount: z.number().int().min(0),
})
export type Conversation = z.infer<typeof ConversationSchema>

// ─── Message ─────────────────────────────────────────────────────────────────
export const MessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  sender: z.string(),
  senderName: z.string(),
  direction: z.enum(['incoming', 'outgoing']),
  status: z.enum(['received', 'sent']),
  platform: PlatformSchema,
  timestamp: z.coerce.date(),
})
export type Message = z.infer<typeof MessageSchema>

// ─── Contact ─────────────────────────────────────────────────────────────────
export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  rfc: z.string().optional(),
  funnelStage: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Contact = z.infer<typeof ContactSchema>

// ─── Order ───────────────────────────────────────────────────────────────────
export const OrderItemSchema = z.object({
  product: z.string(),
  sku: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  notes: z.string().optional(),
})

export const OrderSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  contactId: z.string(),
  contactName: z.string(),
  contactCompany: z.string().optional(),
  conversationId: z.string().optional(),
  platform: PlatformSchema.optional(),
  items: z.array(OrderItemSchema),
  total: z.number().nonnegative(),
  status: z.enum(['nuevo', 'confirmado', 'entregado']),
  notes: z.string().optional(),
  createdBy: z.enum(['ai', 'manual']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Order = z.infer<typeof OrderSchema>
export type OrderItem = z.infer<typeof OrderItemSchema>

// ─── AI Agent ────────────────────────────────────────────────────────────────
export const AiAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(['openai', 'anthropic', 'custom']),
  model: z.string(),
  systemPrompt: z.string(),
  isActive: z.boolean(),
  channels: z.object({
    whatsapp: z.boolean(),
    instagram: z.boolean(),
    messenger: z.boolean(),
  }),
  knowledgeBases: z.array(z.string()),
  createdAt: z.coerce.date(),
})
export type AiAgent = z.infer<typeof AiAgentSchema>
