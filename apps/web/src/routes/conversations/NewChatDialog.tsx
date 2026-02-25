import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { db } from '@/lib/firebase'
import type { Contact, Platform } from '@/types'

// ─── Schemas ───────────────────────────────────────────────────────────────────

const existingSchema = z.object({
  contactId: z.string().min(1, 'Selecciona un contacto'),
  platform: z.enum(['whatsapp', 'instagram', 'messenger'], {
    required_error: 'Selecciona una plataforma',
  }),
  initialMessage: z.string().optional(),
})

const newContactSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  phone: z.string().optional(),
  platform: z.enum(['whatsapp', 'instagram', 'messenger'], {
    required_error: 'Selecciona una plataforma',
  }),
  initialMessage: z.string().optional(),
})

type ExistingForm = z.infer<typeof existingSchema>
type NewContactForm = z.infer<typeof newContactSchema>

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

// ─── Platform selector ─────────────────────────────────────────────────────────

function PlatformSelector({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PLATFORMS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          className={cn(
            'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm transition-all',
            value === p.value
              ? 'border-brand-500 bg-brand-600/15 text-white'
              : 'border-white/15 text-gray-400 hover:bg-white/5',
          )}
        >
          <span className="text-xl">{p.icon}</span>
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Main dialog ───────────────────────────────────────────────────────────────

export default function NewChatDialog({
  open,
  onOpenChange,
  contacts,
  orgId,
  userName,
  onCreate,
  isCreating,
}: Props) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [isCreatingContact, setIsCreatingContact] = useState(false)

  const existingForm = useForm<ExistingForm>({ resolver: zodResolver(existingSchema) })
  const newForm = useForm<NewContactForm>({ resolver: zodResolver(newContactSchema) })

  const isBusy = isCreating || isCreatingContact

  function handleClose() {
    if (isBusy) return
    onOpenChange(false)
    existingForm.reset()
    newForm.reset()
    setMode('existing')
  }

  async function onSubmitExisting(data: ExistingForm) {
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
    existingForm.reset()
  }

  async function onSubmitNew(data: NewContactForm) {
    if (!orgId) return
    setIsCreatingContact(true)
    try {
      // Create the contact directly so we can capture the new document ID
      const contactRef = await addDoc(collection(db, 'contacts'), {
        name: data.name,
        ...(data.phone ? { phone: data.phone } : {}),
        orgId,
        createdAt: serverTimestamp(),
      })
      // Invalidate contacts cache so the list refreshes
      qc.invalidateQueries({ queryKey: ['contacts', orgId] })
      toast.success('Contacto creado')

      await onCreate({
        contactId: contactRef.id,
        contactName: data.name,
        contactPhone: data.phone || undefined,
        platform: data.platform,
        orgId,
        initialMessage: data.initialMessage?.trim() || undefined,
        senderName: userName,
      })
      newForm.reset()
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setIsCreatingContact(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isBusy) { onOpenChange(o); if (!o) handleClose() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo Chat</DialogTitle>
        </DialogHeader>

        {/* Mode switcher */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
          {(['existing', 'new'] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={isBusy}
              onClick={() => setMode(m)}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-sm font-medium transition-all',
                mode === m
                  ? 'bg-brand-600/25 text-brand-300 border border-brand-500/25'
                  : 'text-gray-500 hover:text-gray-300',
              )}
            >
              {m === 'existing' ? 'Contacto existente' : 'Nuevo contacto'}
            </button>
          ))}
        </div>

        {/* ── Existing contact ──────────────────────────────────────────────── */}
        {mode === 'existing' && (
          <form onSubmit={existingForm.handleSubmit(onSubmitExisting)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Contacto *</Label>
              <Controller
                name="contactId"
                control={existingForm.control}
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
              {existingForm.formState.errors.contactId && (
                <p className="text-xs text-red-400">{existingForm.formState.errors.contactId.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Plataforma *</Label>
              <Controller
                name="platform"
                control={existingForm.control}
                render={({ field }) => (
                  <PlatformSelector value={field.value} onChange={field.onChange} />
                )}
              />
              {existingForm.formState.errors.platform && (
                <p className="text-xs text-red-400">{existingForm.formState.errors.platform.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Mensaje inicial (opcional)</Label>
              <Textarea
                placeholder="Escribe el primer mensaje..."
                rows={3}
                {...existingForm.register('initialMessage')}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isBusy}>
                Cancelar
              </Button>
              <Button type="submit" loading={isBusy}>
                Iniciar Chat
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* ── New contact ───────────────────────────────────────────────────── */}
        {mode === 'new' && (
          <form onSubmit={newForm.handleSubmit(onSubmitNew)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input placeholder="Juan Pérez" {...newForm.register('name')} />
                {newForm.formState.errors.name && (
                  <p className="text-xs text-red-400">{newForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input placeholder="+52 55 1234 5678" {...newForm.register('phone')} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Plataforma *</Label>
              <Controller
                name="platform"
                control={newForm.control}
                render={({ field }) => (
                  <PlatformSelector value={field.value} onChange={field.onChange} />
                )}
              />
              {newForm.formState.errors.platform && (
                <p className="text-xs text-red-400">{newForm.formState.errors.platform.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Mensaje inicial (opcional)</Label>
              <Textarea
                placeholder="Escribe el primer mensaje..."
                rows={3}
                {...newForm.register('initialMessage')}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isBusy}>
                Cancelar
              </Button>
              <Button type="submit" loading={isBusy}>
                Crear y Chatear
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
