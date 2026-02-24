import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Contact, Platform } from '@/types'

const schema = z.object({
  contactId: z.string().min(1, 'Selecciona un contacto'),
  platform: z.enum(['whatsapp', 'instagram', 'messenger'], {
    required_error: 'Selecciona una plataforma',
  }),
  initialMessage: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const PLATFORMS: { value: Platform; label: string; icon: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp', icon: '📱' },
  { value: 'instagram', label: 'Instagram', icon: '📷' },
  { value: 'messenger', label: 'Messenger', icon: '💬' },
]

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  contacts: Contact[]
  orgId: string | undefined
  userName: string
  onCreate: (data: {
    contactId: string
    contactName: string
    contactPhone?: string
    platform: Platform
    orgId: string
    initialMessage?: string
    senderName: string
  }) => Promise<void>
  isCreating: boolean
}

export default function NewChatDialog({
  open,
  onOpenChange,
  contacts,
  orgId,
  userName,
  onCreate,
  isCreating,
}: Props) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const selectedPlatform = watch('platform')

  async function onSubmit(data: FormData) {
    if (!orgId) return
    const contact = contacts.find((c) => c.id === data.contactId)
    if (!contact) return
    await onCreate({
      contactId: contact.id,
      contactName: contact.name,
      contactPhone: contact.phone,
      platform: data.platform,
      orgId,
      initialMessage: data.initialMessage?.trim() || undefined,
      senderName: userName,
    })
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isCreating) { onOpenChange(o); reset() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo Chat</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Contact */}
          <div className="space-y-1.5">
            <Label>Contacto *</Label>
            <Controller
              name="contactId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un contacto..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.company ? `— ${c.company}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.contactId && <p className="text-xs text-red-400">{errors.contactId.message}</p>}
          </div>

          {/* Platform */}
          <div className="space-y-1.5">
            <Label>Plataforma *</Label>
            <Controller
              name="platform"
              control={control}
              render={({ field }) => (
                <div className="grid grid-cols-3 gap-2">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => field.onChange(p.value)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm transition-all',
                        field.value === p.value
                          ? 'border-brand-500 bg-brand-600/15 text-white'
                          : 'border-white/15 text-gray-400 hover:bg-white/5',
                      )}
                    >
                      <span className="text-xl">{p.icon}</span>
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              )}
            />
            {errors.platform && <p className="text-xs text-red-400">{errors.platform.message}</p>}
          </div>

          {/* Initial message */}
          <div className="space-y-1.5">
            <Label>Mensaje inicial (opcional)</Label>
            <Textarea
              placeholder="Escribe el primer mensaje..."
              rows={3}
              {...register('initialMessage')}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { onOpenChange(false); reset() }}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isCreating}>
              Iniciar Chat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
