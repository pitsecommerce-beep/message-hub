import { z } from 'zod'

// ─── Auth / Users ─────────────────────────────────────────────────────────────

export const RoleSchema = z.enum(['admin', 'manager', 'agent'])
export type Role = z.infer<typeof RoleSchema>

export const UserDataSchema = z.object({
  uid: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  orgId: z.string(),
  createdAt: z.any(), // Firestore Timestamp
})
export type UserData = z.infer<typeof UserDataSchema>

// ─── Organization ─────────────────────────────────────────────────────────────

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  inviteCode: z.string(),
  brandName: z.string().optional(),
  logoUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  members: z.array(z.string()).optional(),
  createdAt: z.any(),
})
export type Organization = z.infer<typeof OrganizationSchema>

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const FunnelStageSchema = z.enum([
  'curioso',
  'cotizando',
  'pago_pendiente',
  'orden_pendiente',
  'entregado',
  'atencion_inmediata',
])
export type FunnelStage = z.infer<typeof FunnelStageSchema>

export const FUNNEL_STAGES: { id: FunnelStage; name: string; color: string }[] = [
  { id: 'curioso', name: 'Curioso', color: '#3B82F6' },
  { id: 'cotizando', name: 'Cotizando', color: '#F59E0B' },
  { id: 'pago_pendiente', name: 'Pago Pendiente', color: '#EF4444' },
  { id: 'orden_pendiente', name: 'Orden Pendiente', color: '#8B5CF6' },
  { id: 'entregado', name: 'Entregado', color: '#10B981' },
  { id: 'atencion_inmediata', name: 'Atención Inmediata', color: '#EC4899' },
]

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  rfc: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  funnelStage: FunnelStageSchema.optional(),
  funnelUpdatedAt: z.any().optional(),
  orgId: z.string(),
  createdAt: z.any(),
  updatedAt: z.any().optional(),
})
export type Contact = z.infer<typeof ContactSchema>

// ─── Conversations ─────────────────────────────────────────────────────────────

export const PlatformSchema = z.enum(['whatsapp', 'instagram', 'messenger'])
export type Platform = z.infer<typeof PlatformSchema>

export const ConversationSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  contactName: z.string(),
  contactPhone: z.string().optional(),
  platform: PlatformSchema,
  orgId: z.string(),
  assignedTo: z.string().optional(),
  aiEnabled: z.boolean().optional(),
  funnelStage: FunnelStageSchema.optional(),
  lastMessage: z.string().optional(),
  lastMessageAt: z.any().optional(),
  unreadCount: z.number().optional(),
  createdAt: z.any(),
})
export type Conversation = z.infer<typeof ConversationSchema>

export const MessageSchema = z.object({
  id: z.string(),
  convId: z.string(),
  text: z.string(),
  role: z.enum(['user', 'agent', 'ai']),
  senderName: z.string().optional(),
  timestamp: z.any(),
  platform: PlatformSchema.optional(),
})
export type Message = z.infer<typeof MessageSchema>

// ─── Orders ───────────────────────────────────────────────────────────────────

export const OrderStatusSchema = z.enum([
  'pendiente',
  'pago_pendiente',
  'procesando',
  'enviado',
  'entregado',
  'cancelado',
])
export type OrderStatus = z.infer<typeof OrderStatusSchema>

export const OrderItemSchema = z.object({
  sku: z.string().optional(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  total: z.number(),
})
export type OrderItem = z.infer<typeof OrderItemSchema>

export const OrderSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  contactId: z.string(),
  contactName: z.string(),
  conversationId: z.string().optional(),
  orgId: z.string(),
  status: OrderStatusSchema,
  items: z.array(OrderItemSchema).optional(),
  total: z.number().optional(),
  notes: z.string().optional(),
  createdAt: z.any(),
  updatedAt: z.any().optional(),
})
export type Order = z.infer<typeof OrderSchema>

// ─── Payment Links ─────────────────────────────────────────────────────────────

export const PaymentGatewaySchema = z.enum(['stripe', 'mercadopago'])
export type PaymentGateway = z.infer<typeof PaymentGatewaySchema>

export const PaymentLinkSchema = z.object({
  id: z.string(),
  convId: z.string(),
  orderId: z.string().optional(),
  amount: z.number(),
  description: z.string(),
  gateway: PaymentGatewaySchema,
  status: z.enum(['pending', 'paid', 'cancelled']),
  trackingRef: z.string(),
  orgId: z.string(),
  createdAt: z.any(),
  paidAt: z.any().optional(),
})
export type PaymentLink = z.infer<typeof PaymentLinkSchema>

// ─── AI Agents ────────────────────────────────────────────────────────────────

export const AIProviderSchema = z.enum(['openai', 'anthropic', 'custom'])
export type AIProvider = z.infer<typeof AIProviderSchema>

export const AIAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: AIProviderSchema,
  model: z.string(),
  apiKey: z.string().optional(),
  endpoint: z.string().optional(),
  systemPrompt: z.string(),
  knowledgeBases: z.array(z.string()).optional(),
  channels: z.array(PlatformSchema).optional(),
  active: z.boolean(),
  orgId: z.string(),
  createdAt: z.any(),
})
export type AIAgent = z.infer<typeof AIAgentSchema>

// ─── Knowledge Base ────────────────────────────────────────────────────────────

export const KnowledgeBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  orgId: z.string(),
  rowCount: z.number().optional(),
  columns: z.array(z.string()).optional(),
  createdAt: z.any(),
  updatedAt: z.any().optional(),
})
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>

// ─── Integrations ─────────────────────────────────────────────────────────────

export const IntegrationPlatformSchema = z.enum(['whatsapp', 'instagram', 'messenger'])
export type IntegrationPlatform = z.infer<typeof IntegrationPlatformSchema>

export const IntegrationMethodSchema = z.enum(['meta', 'evolution'])
export type IntegrationMethod = z.infer<typeof IntegrationMethodSchema>

export const IntegrationConfigSchema = z.object({
  id: z.string(),
  platform: IntegrationPlatformSchema,
  /** 'meta' = Meta Cloud API (default), 'evolution' = Evolution API via QR */
  method: IntegrationMethodSchema.optional(),
  connected: z.boolean(),
  // ── Meta Cloud API fields ──────────────────────────────────────────────────
  phoneNumberId: z.string().optional(),
  accessToken: z.string().optional(),
  verifyToken: z.string().optional(),
  webhookUrl: z.string().optional(),
  // ── Evolution API fields ───────────────────────────────────────────────────
  evolutionApiUrl: z.string().optional(),
  evolutionApiKey: z.string().optional(),
  evolutionInstanceName: z.string().optional(),
  evolutionPhone: z.string().optional(),
  orgId: z.string(),
  updatedAt: z.any().optional(),
})
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>

// ─── Team Members ─────────────────────────────────────────────────────────────

export const TeamMemberSchema = z.object({
  uid: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  orgId: z.string(),
  createdAt: z.any(),
})
export type TeamMember = z.infer<typeof TeamMemberSchema>
