import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { doc, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { toast } from 'sonner'
import { Upload, X, Building2 } from 'lucide-react'
import { db, storage } from '@/lib/firebase'
import { useAppStore } from '@/store/app.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const brandSchema = z.object({
  brandName: z.string().min(1, 'Ingresa el nombre de tu marca'),
})
type BrandForm = z.infer<typeof brandSchema>

export default function SettingsPage() {
  const { userData, organization, setOrganization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id
  const [logoUploading, setLogoUploading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BrandForm>({
    resolver: zodResolver(brandSchema),
    defaultValues: { brandName: organization?.brandName ?? organization?.name ?? '' },
  })

  async function saveBrandName(data: BrandForm) {
    if (!orgId) return
    await updateDoc(doc(db, 'organizations', orgId), { brandName: data.brandName })
    if (organization) {
      setOrganization({ ...organization, brandName: data.brandName })
    }
    toast.success('Nombre actualizado')
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !orgId) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('El archivo supera 2MB')
      return
    }
    setLogoUploading(true)
    try {
      const storageRef = ref(storage, `organizations/${orgId}/logo`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await updateDoc(doc(db, 'organizations', orgId), { logoUrl: url })
      if (organization) setOrganization({ ...organization, logoUrl: url })
      toast.success('Logo actualizado')
    } catch (err: unknown) {
      toast.error((err as Error).message)
    } finally {
      setLogoUploading(false)
    }
  }

  async function removeLogo() {
    if (!orgId || !organization?.logoUrl) return
    try {
      const storageRef = ref(storage, `organizations/${orgId}/logo`)
      await deleteObject(storageRef).catch(() => {})
      await updateDoc(doc(db, 'organizations', orgId), { logoUrl: null })
      if (organization) setOrganization({ ...organization, logoUrl: undefined })
      toast.success('Logo eliminado')
    } catch (err: unknown) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Personaliza la apariencia de tu organización</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Brand name */}
          <form onSubmit={handleSubmit(saveBrandName)} className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>Nombre de la marca</Label>
              <Input placeholder={organization?.name ?? 'Mi Empresa'} {...register('brandName')} />
              {errors.brandName && <p className="text-xs text-red-400">{errors.brandName.message}</p>}
            </div>
            <Button type="submit" className="self-end" loading={isSubmitting}>
              Guardar
            </Button>
          </form>

          {/* Logo */}
          <div className="space-y-2">
            <Label>Logotipo</Label>
            {organization?.logoUrl ? (
              <div className="flex items-center gap-3">
                <img
                  src={organization.logoUrl}
                  alt="Logo"
                  className="h-12 w-auto rounded-lg border border-white/15 object-contain bg-white/5 p-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                  onClick={removeLogo}
                >
                  <X size={13} /> Eliminar
                </Button>
              </div>
            ) : (
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/8 text-sm text-gray-300 transition-colors">
                  <Upload size={14} />
                  {logoUploading ? 'Subiendo...' : 'Subir logo'}
                </div>
                <span className="text-xs text-gray-500">PNG, JPG, SVG · máx 2MB</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={uploadLogo}
                  disabled={logoUploading}
                />
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Organization info */}
      <Card>
        <CardHeader>
          <CardTitle>Información de la Organización</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3">
            <Building2 size={16} className="text-gray-500" />
            <div>
              <p className="text-xs text-gray-500">Nombre</p>
              <p className="text-sm font-medium text-white">{organization?.name ?? '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3">
            <div className="text-gray-500 text-sm">ID</div>
            <div>
              <p className="text-xs text-gray-500">ID de organización</p>
              <p className="text-sm font-mono text-gray-400">{orgId ?? '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
