/**
 * IntegrationsPage.tsx
 *
 * Gestiona las integraciones de plataformas de mensajería:
 *  - WhatsApp vía Meta Cloud API  (credenciales manuales)
 *  - WhatsApp vía Evolution API   (escaneo de QR)
 *  - Instagram DM                 (Meta Cloud API)
 *  - Facebook Messenger           (Meta Cloud API)
 */
import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Copy,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  QrCode,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app.store'
import {
  useIntegrations,
  useSaveIntegration,
  useDeleteIntegration,
  usePaymentGateways,
  useSavePaymentGateway,
  useDeletePaymentGateway,
} from '@/features/config/hooks/use-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { createEvolutionClient } from '@/lib/evolution-api'
import type { IntegrationPlatform, IntegrationConfig, IntegrationMethod, PaymentGatewayPlatform, PaymentGatewayConfig } from '@/types'

// ─── Constants ─────────────────────────────────────────────────────────────────

const INTEGRATION_INFO: Record<
  IntegrationPlatform,
  { name: string; icon: string; color: string; bgColor: string; description: string }
> = {
  whatsapp: {
    name: 'WhatsApp Business',
    icon: '📱',
    color: 'text-green-400',
    bgColor: 'bg-green-600/15',
    description:
      'Conecta tu número de WhatsApp vía Meta Cloud API o Evolution API (QR)',
  },
  instagram: {
    name: 'Instagram DM',
    icon: '📷',
    color: 'text-pink-400',
    bgColor: 'bg-pink-600/15',
    description: 'Conecta tu cuenta de Instagram Business para recibir DMs',
  },
  messenger: {
    name: 'Facebook Messenger',
    icon: '💬',
    color: 'text-blue-400',
    bgColor: 'bg-blue-600/15',
    description:
      'Conecta tu Página de Facebook para gestionar mensajes de Messenger',
  },
}

const QR_POLL_INTERVAL_MS = 8_000 // refresh QR every 8 s

// ─── Schemas ───────────────────────────────────────────────────────────────────

const metaSchema = z.object({
  phoneNumberId: z.string().min(1, 'Requerido'),
  accessToken: z.string().min(1, 'Requerido'),
  verifyToken: z.string().optional(),
  customWebhookUrl: z.string().optional(),
})
type MetaForm = z.infer<typeof metaSchema>

const evolutionSchema = z.object({
  serverUrl: z
    .string()
    .url('Debe ser una URL válida, p. ej. https://api.tuservidor.com')
    .min(1, 'Requerido'),
  apiKey: z.string().min(1, 'Requerido'),
  instanceName: z
    .string()
    .min(2, 'Mínimo 2 caracteres')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Solo letras, números, guiones y guiones bajos'),
})
type EvolutionForm = z.infer<typeof evolutionSchema>

// ─── IntegrationCard ───────────────────────────────────────────────────────────

function IntegrationCard({
  platform,
  config,
  onConfigureMeta,
  onConfigureEvolution,
  onDisconnect,
}: {
  platform: IntegrationPlatform
  config: IntegrationConfig | undefined
  onConfigureMeta: () => void
  onConfigureEvolution: () => void
  onDisconnect: () => void
}) {
  const info = INTEGRATION_INFO[platform]
  const isConnected = config?.connected ?? false
  const method = config?.method ?? 'meta'

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4 hover:border-white/20 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-xl ${info.bgColor}`}>
            {info.icon}
          </div>
          <div>
            <p className="font-medium text-white">{info.name}</p>
            <p className="text-xs text-gray-500 mt-0.5 max-w-[220px]">
              {info.description}
            </p>
          </div>
        </div>
        <Badge variant={isConnected ? 'success' : 'secondary'}>
          {isConnected ? (
            <><CheckCircle size={10} /> Conectado</>
          ) : (
            <><AlertCircle size={10} /> Sin conectar</>
          )}
        </Badge>
      </div>

      {/* Connected info */}
      {isConnected && (
        <div className="rounded-lg bg-white/5 px-3 py-2 space-y-1">
          {method === 'evolution' ? (
            <>
              <p className="text-xs text-gray-500">Evolution API · instancia</p>
              <p className="text-sm text-gray-300 font-mono">
                {config?.evolutionInstanceName}
              </p>
              {config?.evolutionPhone && (
                <p className="text-xs text-gray-500">{config.evolutionPhone}</p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">Meta Cloud API · Phone Number ID</p>
              <p className="text-sm text-gray-300 font-mono">{config?.phoneNumberId}</p>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {platform === 'whatsapp' && !isConnected && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={onConfigureEvolution}>
              <QrCode size={13} className="mr-1.5" />
              QR (Evolution)
            </Button>
            <Button variant="default" size="sm" onClick={onConfigureMeta}>
              Meta Cloud API
            </Button>
          </div>
        )}

        {platform === 'whatsapp' && isConnected && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={method === 'evolution' ? onConfigureEvolution : onConfigureMeta}
            >
              Reconfigurar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-400 border-red-500/30 hover:bg-red-500/10"
              onClick={onDisconnect}
            >
              Desconectar
            </Button>
          </div>
        )}

        {platform !== 'whatsapp' && (
          <div className="flex gap-2">
            <Button
              variant={isConnected ? 'outline' : 'default'}
              size="sm"
              className="flex-1"
              onClick={onConfigureMeta}
            >
              {isConnected ? 'Reconfigurar' : 'Configurar'}
            </Button>
            {isConnected && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                onClick={onDisconnect}
              >
                Desconectar
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── MetaConfigDialog ──────────────────────────────────────────────────────────

function MetaConfigDialog({
  open,
  onOpenChange,
  platform,
  existing,
  orgId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  platform: IntegrationPlatform | null
  existing: IntegrationConfig | undefined
  orgId: string | undefined
}) {
  const saveIntegration = useSaveIntegration(orgId)
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<MetaForm>({
    resolver: zodResolver(metaSchema),
    defaultValues: {
      phoneNumberId: existing?.phoneNumberId ?? '',
      accessToken: '',
      verifyToken: existing?.verifyToken ?? '',
      customWebhookUrl: existing?.webhookUrl ?? '',
    },
  })

  if (!platform) return null
  const info = INTEGRATION_INFO[platform]
  const webhookBase =
    import.meta.env.VITE_WEBHOOK_BASE_URL ??
    'https://your-region-your-project.cloudfunctions.net/webhook'
  const webhookUrl = `${webhookBase}/${platform}`

  async function onSubmit(data: MetaForm) {
    if (!orgId || !platform) return
    await saveIntegration.mutateAsync({
      id: existing?.id,
      platform,
      method: 'meta',
      connected: true,
      phoneNumberId: data.phoneNumberId,
      accessToken: data.accessToken,
      verifyToken: data.verifyToken,
      webhookUrl: data.customWebhookUrl || webhookUrl,
      orgId,
    })
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isSubmitting) {
          onOpenChange(o)
          reset()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {info.icon} Configurar {info.name} — Meta Cloud API
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Phone Number ID / Page ID</Label>
            <Input placeholder="123456789012345" {...register('phoneNumberId')} />
            {errors.phoneNumberId && (
              <p className="text-xs text-red-400">{errors.phoneNumberId.message}</p>
            )}
            <p className="text-xs text-gray-500">
              Meta Developer Console → App → {info.name}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Access Token</Label>
            <Input
              type="password"
              placeholder="EAAxxxx..."
              {...register('accessToken')}
            />
            {errors.accessToken && (
              <p className="text-xs text-red-400">{errors.accessToken.message}</p>
            )}
            <p className="text-xs text-gray-500">
              Token de acceso permanente desde Meta Developer Console
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Verify Token (Webhook)</Label>
            <Input
              placeholder="mi_token_secreto"
              {...register('verifyToken')}
            />
            <p className="text-xs text-gray-500">
              Token secreto para verificar el webhook con Meta
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>URL del Webhook</Label>
            <div className="flex items-center gap-2">
              <Input
                value={webhookUrl}
                readOnly
                className="font-mono text-xs text-gray-400"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(webhookUrl)
                  toast.success('URL copiada')
                }}
              >
                <Copy size={14} />
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Pega esta URL en la configuración del webhook de Meta
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                reset()
              }}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Guardar Configuración
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── EvolutionQRDialog ─────────────────────────────────────────────────────────

type QRStep = 'config' | 'qr' | 'connected'

interface EvolutionConnectConfig {
  serverUrl: string
  apiKey: string
  instanceName: string
}

function EvolutionQRDialog({
  open,
  onOpenChange,
  existing,
  orgId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  existing: IntegrationConfig | undefined
  orgId: string | undefined
}) {
  const saveIntegration = useSaveIntegration(orgId)

  const [step, setStep] = useState<QRStep>('config')
  const [connectConfig, setConnectConfig] = useState<EvolutionConnectConfig | null>(null)
  const [qrCode, setQrCode] = useState<string>('')
  const [qrError, setQrError] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)
  const [statusLabel, setStatusLabel] = useState('Esperando escaneo…')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const savedRef = useRef(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EvolutionForm>({
    resolver: zodResolver(evolutionSchema),
    defaultValues: {
      serverUrl: existing?.evolutionApiUrl ?? '',
      apiKey: '',
      instanceName: existing?.evolutionInstanceName ?? '',
    },
  })

  // Clear poll on unmount / close
  useEffect(() => {
    if (!open) {
      stopPolling()
      setStep('config')
      setQrCode('')
      setQrError('')
      setConnectConfig(null)
      savedRef.current = false
    }
  }, [open])

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // Start polling once we enter the QR step
  useEffect(() => {
    if (step !== 'qr' || !connectConfig) return

    stopPolling()
    savedRef.current = false

    async function tick() {
      if (!connectConfig || savedRef.current) return
      const client = createEvolutionClient(connectConfig.serverUrl, connectConfig.apiKey)

      try {
        // 1. Check connection state
        const stateRes = await client.getConnectionState(connectConfig.instanceName)
        const state = stateRes.instance?.state

        if (state === 'open') {
          stopPolling()
          savedRef.current = true
          setStatusLabel('¡Conectado!')
          setStep('connected')

          // Configure webhook on the Evolution API instance
          const evolutionWebhookUrl = import.meta.env.VITE_EVOLUTION_WEBHOOK_URL ?? ''
          if (evolutionWebhookUrl) {
            try {
              await client.setWebhook(connectConfig.instanceName, evolutionWebhookUrl)
            } catch {
              // Non-fatal – user can configure webhook manually
            }
          }

          // Persist to Firestore
          await saveIntegration.mutateAsync({
            id: existing?.id,
            platform: 'whatsapp',
            method: 'evolution',
            connected: true,
            evolutionApiUrl: connectConfig.serverUrl,
            evolutionApiKey: connectConfig.apiKey,
            evolutionInstanceName: connectConfig.instanceName,
            orgId: orgId!,
          })

          // Auto-close after 2 s
          setTimeout(() => onOpenChange(false), 2_000)
          return
        }

        // 2. Refresh QR code while not yet connected
        try {
          const qrRes = await client.getQR(connectConfig.instanceName)
          if (qrRes.code) {
            setQrCode(qrRes.code)
            setQrError('')
          }
        } catch {
          // QR fetch can fail transiently – keep showing the last good QR
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error de conexión'
        setStatusLabel(msg)
      }
    }

    // First tick immediately, then poll
    tick()
    pollRef.current = setInterval(tick, QR_POLL_INTERVAL_MS)

    return stopPolling
  }, [step, connectConfig]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onConfigSubmit(data: EvolutionForm) {
    setIsCreating(true)
    setQrError('')

    const client = createEvolutionClient(data.serverUrl, data.apiKey)

    try {
      // Try to create the instance (409 = already exists → fine)
      try {
        await client.createInstance(data.instanceName)
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status !== 409) throw err
      }

      // Fetch initial QR
      const qrRes = await client.getQR(data.instanceName)
      if (!qrRes.code) throw new Error('No se recibió QR del servidor')

      setQrCode(qrRes.code)
      setConnectConfig({ serverUrl: data.serverUrl, apiKey: data.apiKey, instanceName: data.instanceName })
      setStatusLabel('Esperando escaneo…')
      setStep('qr')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setQrError(msg)
      toast.error(`Error: ${msg}`)
    } finally {
      setIsCreating(false)
    }
  }

  async function handleManualRefresh() {
    if (!connectConfig) return
    const client = createEvolutionClient(connectConfig.serverUrl, connectConfig.apiKey)
    try {
      const qrRes = await client.getQR(connectConfig.instanceName)
      if (qrRes.code) {
        setQrCode(qrRes.code)
        setQrError('')
        toast.success('QR actualizado')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      setQrError(msg)
    }
  }

  function handleClose() {
    if (isCreating) return
    stopPolling()
    onOpenChange(false)
    reset()
  }

  // Render: Step config
  const renderConfig = () => (
    <form onSubmit={handleSubmit(onConfigSubmit)} className="space-y-4">
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-xs text-green-300 space-y-1">
        <p className="font-semibold">¿Qué es Evolution API?</p>
        <p>
          Evolution API es un servidor auto-hospedado que conecta WhatsApp sin necesidad
          de aprobación de Meta. Solo escaneas el QR con tu teléfono y listo.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>URL del servidor Evolution API</Label>
        <Input
          placeholder="https://api.tuservidor.com"
          {...register('serverUrl')}
        />
        {errors.serverUrl && (
          <p className="text-xs text-red-400">{errors.serverUrl.message}</p>
        )}
        <p className="text-xs text-gray-500">
          URL base de tu instancia de Evolution API (sin barra final)
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>API Key global</Label>
        <Input
          type="password"
          placeholder="tu-api-key-global"
          {...register('apiKey')}
        />
        {errors.apiKey && (
          <p className="text-xs text-red-400">{errors.apiKey.message}</p>
        )}
        <p className="text-xs text-gray-500">
          La clave definida en AUTHENTICATION_API_KEY de tu servidor
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Nombre de la instancia</Label>
        <Input
          placeholder="mi-empresa-wa"
          {...register('instanceName')}
        />
        {errors.instanceName && (
          <p className="text-xs text-red-400">{errors.instanceName.message}</p>
        )}
        <p className="text-xs text-gray-500">
          Identificador único (letras, números, guiones). Se creará si no existe.
        </p>
      </div>

      {qrError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
          {qrError}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={handleClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={isCreating}>
          <QrCode size={14} className="mr-1.5" />
          Obtener QR
        </Button>
      </DialogFooter>
    </form>
  )

  // Render: Step QR
  const renderQR = () => (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center space-y-1">
        <p className="text-sm text-gray-300">
          Abre WhatsApp en tu teléfono → <span className="font-semibold">Dispositivos vinculados</span> → <span className="font-semibold">Vincular dispositivo</span>
        </p>
        <p className="text-xs text-gray-500">
          El QR se actualiza automáticamente cada ~30 s
        </p>
      </div>

      {qrCode ? (
        <div className="relative">
          <img
            src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="WhatsApp QR Code"
            className="w-56 h-56 rounded-xl border border-white/10 bg-white p-2"
          />
          <div className="absolute -bottom-3 -right-3">
            <button
              type="button"
              title="Actualizar QR"
              onClick={handleManualRefresh}
              className="rounded-full bg-white/10 hover:bg-white/20 p-1.5 transition-colors"
            >
              <RefreshCw size={12} className="text-gray-400" />
            </button>
          </div>
        </div>
      ) : (
        <div className="w-56 h-56 rounded-xl border border-white/10 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-gray-500" />
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <Loader2 size={14} className="animate-spin text-yellow-400" />
        <span className="text-gray-400">{statusLabel}</span>
      </div>

      <div className="flex gap-2 w-full">
        <Button variant="outline" size="sm" className="flex-1" onClick={handleClose}>
          Cancelar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => {
            stopPolling()
            setStep('config')
            setQrCode('')
          }}
        >
          Cambiar config
        </Button>
      </div>
    </div>
  )

  // Render: Step connected
  const renderConnected = () => (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center">
        <Wifi size={32} className="text-green-400" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-white">¡WhatsApp Conectado!</p>
        <p className="text-sm text-gray-400 mt-1">
          Instancia <span className="font-mono text-gray-300">{connectConfig?.instanceName}</span> activa
        </p>
        <p className="text-xs text-gray-500 mt-2">Cerrando automáticamente…</p>
      </div>
      <CheckCircle size={20} className="text-green-400" />
    </div>
  )

  const stepTitles: Record<QRStep, string> = {
    config: '📱 Conectar WhatsApp via Evolution API',
    qr: '📷 Escanea el código QR',
    connected: '✅ WhatsApp Conectado',
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
        </DialogHeader>

        {step === 'config' && renderConfig()}
        {step === 'qr' && renderQR()}
        {step === 'connected' && renderConnected()}
      </DialogContent>
    </Dialog>
  )
}

// ─── DisconnectEvolutionHelper ─────────────────────────────────────────────────
// Tries to logout the Evolution instance before removing it from Firestore.

async function tryLogoutEvolution(config: IntegrationConfig) {
  if (
    config.method !== 'evolution' ||
    !config.evolutionApiUrl ||
    !config.evolutionApiKey ||
    !config.evolutionInstanceName
  )
    return
  try {
    const client = createEvolutionClient(config.evolutionApiUrl, config.evolutionApiKey)
    await client.logout(config.evolutionInstanceName)
  } catch {
    // Best-effort – proceed with Firestore deletion regardless
  }
}

// ─── Payment Gateway Schemas ──────────────────────────────────────────────────

const stripeSchema = z.object({
  publishableKey: z.string().min(1, 'Requerido'),
  secretKey: z.string().min(1, 'Requerido'),
  webhookSecret: z.string().optional(),
})
type StripeForm = z.infer<typeof stripeSchema>

const mercadoPagoSchema = z.object({
  publicKey: z.string().min(1, 'Requerido'),
  accessToken: z.string().min(1, 'Requerido'),
})
type MercadoPagoForm = z.infer<typeof mercadoPagoSchema>

const PAYMENT_GATEWAY_INFO: Record<PaymentGatewayPlatform, { name: string; icon: string; bgColor: string; description: string }> = {
  stripe: {
    name: 'Stripe',
    icon: '💳',
    bgColor: 'bg-indigo-600/15',
    description: 'Acepta pagos internacionales con tarjeta. Genera ligas de pago desde el chat.',
  },
  mercadopago: {
    name: 'MercadoPago',
    icon: '🏦',
    bgColor: 'bg-sky-600/15',
    description: 'Pagos en México y LATAM: transferencias, OXXO, tarjetas y más.',
  },
}

// ─── PaymentGatewayCard ───────────────────────────────────────────────────────

function PaymentGatewayCard({
  platform,
  config,
  onConfigure,
  onDisconnect,
}: {
  platform: PaymentGatewayPlatform
  config: PaymentGatewayConfig | undefined
  onConfigure: () => void
  onDisconnect: () => void
}) {
  const info = PAYMENT_GATEWAY_INFO[platform]
  const isConnected = config?.connected ?? false

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-xl ${info.bgColor}`}>
            {info.icon}
          </div>
          <div>
            <p className="font-medium text-white">{info.name}</p>
            <p className="text-xs text-gray-500 mt-0.5 max-w-[220px]">{info.description}</p>
          </div>
        </div>
        <Badge variant={isConnected ? 'success' : 'secondary'}>
          {isConnected ? <><CheckCircle size={10} /> Conectado</> : <><AlertCircle size={10} /> Sin conectar</>}
        </Badge>
      </div>

      {isConnected && (
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-gray-500">{platform === 'stripe' ? 'Publishable Key' : 'Public Key'}</p>
          <p className="text-sm text-gray-300 font-mono truncate">
            {platform === 'stripe' ? config?.publishableKey : config?.publicKey}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant={isConnected ? 'outline' : 'default'} size="sm" className="flex-1" onClick={onConfigure}>
          {isConnected ? 'Reconfigurar' : 'Configurar'}
        </Button>
        {isConnected && (
          <Button
            variant="outline"
            size="sm"
            className="text-red-400 border-red-500/30 hover:bg-red-500/10"
            onClick={onDisconnect}
          >
            Desconectar
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── PaymentGatewayConfigDialog ───────────────────────────────────────────────

function PaymentGatewayConfigDialog({
  open,
  onOpenChange,
  platform,
  existing,
  orgId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  platform: PaymentGatewayPlatform | null
  existing: PaymentGatewayConfig | undefined
  orgId: string | undefined
}) {
  const saveGateway = useSavePaymentGateway(orgId)

  const stripeForm = useForm<StripeForm>({
    resolver: zodResolver(stripeSchema),
    defaultValues: { publishableKey: existing?.publishableKey ?? '', secretKey: '', webhookSecret: '' },
  })

  const mpForm = useForm<MercadoPagoForm>({
    resolver: zodResolver(mercadoPagoSchema),
    defaultValues: { publicKey: existing?.publicKey ?? '', accessToken: '' },
  })

  useEffect(() => {
    if (open && platform === 'stripe') {
      stripeForm.reset({ publishableKey: existing?.publishableKey ?? '', secretKey: '', webhookSecret: existing?.webhookSecret ?? '' })
    }
    if (open && platform === 'mercadopago') {
      mpForm.reset({ publicKey: existing?.publicKey ?? '', accessToken: '' })
    }
  }, [open, platform]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!platform) return null
  const info = PAYMENT_GATEWAY_INFO[platform]

  async function onSubmitStripe(data: StripeForm) {
    if (!orgId || !platform) return
    await saveGateway.mutateAsync({
      id: existing?.id,
      platform: 'stripe',
      connected: true,
      publishableKey: data.publishableKey,
      secretKey: data.secretKey,
      webhookSecret: data.webhookSecret,
      orgId,
    })
    onOpenChange(false)
  }

  async function onSubmitMP(data: MercadoPagoForm) {
    if (!orgId || !platform) return
    await saveGateway.mutateAsync({
      id: existing?.id,
      platform: 'mercadopago',
      connected: true,
      publicKey: data.publicKey,
      accessToken: data.accessToken,
      orgId,
    })
    onOpenChange(false)
  }

  const isSubmitting = saveGateway.isPending

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isSubmitting) onOpenChange(o) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{info.icon} Configurar {info.name}</DialogTitle>
        </DialogHeader>

        {platform === 'stripe' ? (
          <form onSubmit={stripeForm.handleSubmit(onSubmitStripe)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Publishable Key</Label>
              <Input placeholder="pk_live_..." {...stripeForm.register('publishableKey')} />
              {stripeForm.formState.errors.publishableKey && <p className="text-xs text-red-400">{stripeForm.formState.errors.publishableKey.message}</p>}
              <p className="text-xs text-gray-500">Dashboard → Developers → API Keys</p>
            </div>
            <div className="space-y-1.5">
              <Label>Secret Key</Label>
              <Input type="password" placeholder="sk_live_..." {...stripeForm.register('secretKey')} />
              {stripeForm.formState.errors.secretKey && <p className="text-xs text-red-400">{stripeForm.formState.errors.secretKey.message}</p>}
              <p className="text-xs text-gray-500">Se almacenará de forma segura</p>
            </div>
            <div className="space-y-1.5">
              <Label>Webhook Secret (opcional)</Label>
              <Input type="password" placeholder="whsec_..." {...stripeForm.register('webhookSecret')} />
              <p className="text-xs text-gray-500">Para verificar webhooks de Stripe</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancelar</Button>
              <Button type="submit" loading={isSubmitting}>Guardar</Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={mpForm.handleSubmit(onSubmitMP)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Public Key</Label>
              <Input placeholder="APP_USR-..." {...mpForm.register('publicKey')} />
              {mpForm.formState.errors.publicKey && <p className="text-xs text-red-400">{mpForm.formState.errors.publicKey.message}</p>}
              <p className="text-xs text-gray-500">Mercado Pago → Tu negocio → Credenciales</p>
            </div>
            <div className="space-y-1.5">
              <Label>Access Token</Label>
              <Input type="password" placeholder="APP_USR-..." {...mpForm.register('accessToken')} />
              {mpForm.formState.errors.accessToken && <p className="text-xs text-red-400">{mpForm.formState.errors.accessToken.message}</p>}
              <p className="text-xs text-gray-500">Se almacenará de forma segura</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancelar</Button>
              <Button type="submit" loading={isSubmitting}>Guardar</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── IntegrationsPage ─────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id
  const { data: integrations = [] } = useIntegrations(orgId)
  const deleteIntegration = useDeleteIntegration(orgId)

  // Payment gateways
  const { data: paymentGateways = [] } = usePaymentGateways(orgId)
  const deleteGateway = useDeletePaymentGateway(orgId)
  const [gatewayPlatform, setGatewayPlatform] = useState<PaymentGatewayPlatform | null>(null)

  const [metaPlatform, setMetaPlatform] = useState<IntegrationPlatform | null>(null)
  const [evolutionOpen, setEvolutionOpen] = useState(false)

  const platforms: IntegrationPlatform[] = ['whatsapp', 'instagram', 'messenger']
  const paymentPlatforms: PaymentGatewayPlatform[] = ['stripe', 'mercadopago']

  async function handleDisconnect(config: IntegrationConfig, platform: IntegrationPlatform) {
    const name = INTEGRATION_INFO[platform].name
    if (!confirm(`¿Desconectar ${name}? Esta acción no se puede deshacer.`)) return
    await tryLogoutEvolution(config)
    deleteIntegration.mutate(config.id)
  }

  function handleDisconnectGateway(config: PaymentGatewayConfig) {
    const name = PAYMENT_GATEWAY_INFO[config.platform].name
    if (!confirm(`¿Desconectar ${name}?`)) return
    deleteGateway.mutate(config.id)
  }

  const whatsappConfig = integrations.find((i) => i.platform === 'whatsapp')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">
          Plataformas de Mensajería
        </h3>
        <p className="text-xs text-gray-500">
          Conecta tus canales de comunicación con MessageHub
        </p>
      </div>

      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {platforms.map((platform) => {
          const config = integrations.find((i) => i.platform === platform)
          return (
            <IntegrationCard
              key={platform}
              platform={platform}
              config={config}
              onConfigureMeta={() => setMetaPlatform(platform)}
              onConfigureEvolution={() => setEvolutionOpen(true)}
              onDisconnect={() => {
                if (config) handleDisconnect(config, platform)
              }}
            />
          )
        })}
      </div>

      {/* Status panel (Evolution) */}
      {whatsappConfig?.method === 'evolution' && whatsappConfig.connected && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 flex items-start gap-3">
          <Wifi size={16} className="text-green-400 mt-0.5 shrink-0" />
          <div className="text-xs space-y-0.5">
            <p className="text-green-300 font-medium">WhatsApp activo vía Evolution API</p>
            <p className="text-gray-400">
              Instancia:{' '}
              <span className="font-mono text-gray-300">
                {whatsappConfig.evolutionInstanceName}
              </span>
            </p>
            {whatsappConfig.evolutionApiUrl && (
              <p className="text-gray-500 truncate max-w-xs">
                Servidor: {whatsappConfig.evolutionApiUrl}
              </p>
            )}
            <p className="text-gray-500 mt-1">
              Los mensajes entrantes se reciben via webhook automáticamente.
            </p>
          </div>
        </div>
      )}

      {/* Disconnected banner */}
      {whatsappConfig?.method === 'evolution' && !whatsappConfig.connected && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 flex items-center gap-3">
          <WifiOff size={16} className="text-yellow-400 shrink-0" />
          <p className="text-xs text-yellow-300">
            La instancia de Evolution API está desconectada. Vuelve a escanear el QR para
            reconectar.
          </p>
        </div>
      )}

      {/* ── Payment Gateways Section ──────────────────────────────────── */}
      <div className="pt-4">
        <h3 className="text-sm font-semibold text-white mb-1">Pasarelas de Pago</h3>
        <p className="text-xs text-gray-500">
          Configura tus pasarelas para generar ligas de pago desde el chat
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paymentPlatforms.map((platform) => {
          const config = paymentGateways.find((g) => g.platform === platform)
          return (
            <PaymentGatewayCard
              key={platform}
              platform={platform}
              config={config}
              onConfigure={() => setGatewayPlatform(platform)}
              onDisconnect={() => { if (config) handleDisconnectGateway(config) }}
            />
          )
        })}
      </div>

      {/* Meta config dialog */}
      <MetaConfigDialog
        open={metaPlatform !== null}
        onOpenChange={(o) => { if (!o) setMetaPlatform(null) }}
        platform={metaPlatform}
        existing={metaPlatform ? integrations.find((i) => i.platform === metaPlatform) : undefined}
        orgId={orgId}
      />

      {/* Evolution QR dialog */}
      <EvolutionQRDialog
        open={evolutionOpen}
        onOpenChange={setEvolutionOpen}
        existing={whatsappConfig?.method === 'evolution' ? whatsappConfig : undefined}
        orgId={orgId}
      />

      {/* Payment gateway config dialog */}
      <PaymentGatewayConfigDialog
        open={gatewayPlatform !== null}
        onOpenChange={(o) => { if (!o) setGatewayPlatform(null) }}
        platform={gatewayPlatform}
        existing={gatewayPlatform ? paymentGateways.find((g) => g.platform === gatewayPlatform) : undefined}
        orgId={orgId}
      />
    </div>
  )
}
