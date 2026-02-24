import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Copy, CheckCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app.store'
import {
  useIntegrations,
  useSaveIntegration,
  useDeleteIntegration,
} from '@/features/config/hooks/use-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { IntegrationPlatform, IntegrationConfig } from '@/types'

const configSchema = z.object({
  phoneNumberId: z.string().optional(),
  accessToken: z.string().optional(),
  verifyToken: z.string().optional(),
  customWebhookUrl: z.string().optional(),
})
type ConfigForm = z.infer<typeof configSchema>

const INTEGRATION_INFO: Record<
  IntegrationPlatform,
  { name: string; icon: string; color: string; description: string }
> = {
  whatsapp: {
    name: 'WhatsApp Business',
    icon: '📱',
    color: 'text-green-400 bg-green-600/15',
    description: 'Conecta tu número de WhatsApp Business a través de la API de Meta',
  },
  instagram: {
    name: 'Instagram DM',
    icon: '📷',
    color: 'text-pink-400 bg-pink-600/15',
    description: 'Conecta tu cuenta de Instagram Business para recibir DMs',
  },
  messenger: {
    name: 'Facebook Messenger',
    icon: '💬',
    color: 'text-blue-400 bg-blue-600/15',
    description: 'Conecta tu Página de Facebook para gestionar mensajes de Messenger',
  },
}

function IntegrationCard({
  platform,
  config,
  onConfigure,
  onDisconnect,
}: {
  platform: IntegrationPlatform
  config: IntegrationConfig | undefined
  onConfigure: () => void
  onDisconnect: () => void
}) {
  const info = INTEGRATION_INFO[platform]
  const isConnected = config?.connected ?? false

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-xl ${info.color.split(' ')[1]}`}>
            {info.icon}
          </div>
          <div>
            <p className="font-medium text-white">{info.name}</p>
            <p className="text-xs text-gray-500 mt-0.5 max-w-[200px]">{info.description}</p>
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

      {isConnected && config?.phoneNumberId && (
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-xs text-gray-500">Phone Number ID</p>
          <p className="text-sm text-gray-300 font-mono">{config.phoneNumberId}</p>
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

function ConfigDialog({
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
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      phoneNumberId: existing?.phoneNumberId ?? '',
      accessToken: '',
      verifyToken: existing?.verifyToken ?? '',
      customWebhookUrl: existing?.webhookUrl ?? '',
    },
  })

  if (!platform) return null
  const info = INTEGRATION_INFO[platform]

  // Generate webhook URL
  const webhookBase = import.meta.env.VITE_WEBHOOK_BASE_URL ?? 'https://your-functions-url/webhook'
  const webhookUrl = `${webhookBase}/${platform}`

  async function onSubmit(data: ConfigForm) {
    if (!orgId || !platform) return
    await saveIntegration.mutateAsync({
      id: existing?.id,
      platform,
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
    <Dialog open={open} onOpenChange={(o) => { if (!isSubmitting) { onOpenChange(o); reset() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {info.icon} Configurar {info.name}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {(platform === 'whatsapp' || platform === 'instagram' || platform === 'messenger') && (
            <div className="space-y-1.5">
              <Label>Phone Number ID / Page ID</Label>
              <Input placeholder="123456789012345" {...register('phoneNumberId')} />
              <p className="text-xs text-gray-500">Desde Meta Developer Console → App → {info.name}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Access Token</Label>
            <Input type="password" placeholder="EAAxxxx..." {...register('accessToken')} />
            <p className="text-xs text-gray-500">Token de acceso permanente desde Meta Developer Console</p>
          </div>

          <div className="space-y-1.5">
            <Label>Verify Token (Webhook)</Label>
            <Input placeholder="mi_token_secreto" {...register('verifyToken')} />
            <p className="text-xs text-gray-500">Crea un token secreto para verificar el webhook con Meta</p>
          </div>

          {/* Webhook URL display */}
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
            <p className="text-xs text-gray-500">Pega esta URL en la configuración del webhook de Meta</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); reset() }} disabled={isSubmitting}>
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

export default function IntegrationsPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id
  const { data: integrations = [] } = useIntegrations(orgId)
  const deleteIntegration = useDeleteIntegration(orgId)

  const [configPlatform, setConfigPlatform] = useState<IntegrationPlatform | null>(null)
  const platforms: IntegrationPlatform[] = ['whatsapp', 'instagram', 'messenger']

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">Plataformas de Mensajería</h3>
        <p className="text-xs text-gray-500">Conecta tus canales de comunicación con MessageHub</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {platforms.map((platform) => {
          const config = integrations.find((i) => i.platform === platform)
          return (
            <IntegrationCard
              key={platform}
              platform={platform}
              config={config}
              onConfigure={() => setConfigPlatform(platform)}
              onDisconnect={() => {
                if (config && confirm(`¿Desconectar ${INTEGRATION_INFO[platform].name}?`)) {
                  deleteIntegration.mutate(config.id)
                }
              }}
            />
          )
        })}
      </div>

      <ConfigDialog
        open={configPlatform !== null}
        onOpenChange={(o) => { if (!o) setConfigPlatform(null) }}
        platform={configPlatform}
        existing={configPlatform ? integrations.find((i) => i.platform === configPlatform) : undefined}
        orgId={orgId}
      />
    </div>
  )
}
