import { useEffect } from 'react'
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
import { FUNNEL_STAGES, type Contact } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Correo inválido').optional().or(z.literal('')),
  rfc: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  funnelStage: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  contact: Contact | null
  onSave: (data: FormData) => Promise<void>
  isSaving: boolean
}

export default function ContactDialog({ open, onOpenChange, contact, onSave, isSaving }: Props) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (open) {
      reset(
        contact
          ? {
              name: contact.name,
              company: contact.company ?? '',
              phone: contact.phone ?? '',
              email: contact.email ?? '',
              rfc: contact.rfc ?? '',
              address: contact.address ?? '',
              notes: contact.notes ?? '',
              funnelStage: contact.funnelStage ?? '',
            }
          : {
              name: '', company: '', phone: '', email: '',
              rfc: '', address: '', notes: '', funnelStage: '',
            },
      )
    }
  }, [open, contact, reset])

  async function onSubmit(data: FormData) {
    await onSave(data)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isSaving) { onOpenChange(o); reset() } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? 'Editar Contacto' : 'Nuevo Contacto'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input placeholder="Juan Pérez" {...register('name')} />
              {errors.name && <p className="text-xs text-red-400">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <Input placeholder="Mi Empresa S.A." {...register('company')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input placeholder="+52 55 1234 5678" {...register('phone')} />
            </div>
            <div className="space-y-1.5">
              <Label>Correo electrónico</Label>
              <Input type="email" placeholder="juan@empresa.com" {...register('email')} />
              {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>RFC</Label>
              <Input placeholder="XAXX010101000" {...register('rfc')} />
            </div>
            <div className="space-y-1.5">
              <Label>Etapa en el Funnel</Label>
              <Controller
                name="funnelStage"
                control={control}
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sin etapa" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sin etapa</SelectItem>
                      {FUNNEL_STAGES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Dirección</Label>
            <Input placeholder="Calle 123, Ciudad, CP" {...register('address')} />
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea placeholder="Información adicional..." rows={2} {...register('notes')} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { onOpenChange(false); reset() }}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isSaving}>
              {contact ? 'Guardar Cambios' : 'Crear Contacto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
