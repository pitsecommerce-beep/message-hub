import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { doc, updateDoc } from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { toast } from 'sonner'
import { Upload, X, Building2, ImageIcon } from 'lucide-react'
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
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    // Reset input so the same file can be re-selected if needed
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file || !orgId) return

    if (!file.type.startsWith('image/')) {
      toast.error('El archivo debe ser una imagen (PNG, JPG, SVG, etc.)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('El archivo supera 2 MB')
      return
    }

    setLogoUploading(true)
    setUploadProgress(0)

    try {
      const storageRef = ref(storage, `organizations/${orgId}/logo`)
      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
      })

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
            setUploadProgress(pct)
          },
          (err) => reject(err),
          () => resolve(),
        )
      })

      const url = await getDownloadURL(storageRef)
      await updateDoc(doc(db, 'organizations', orgId), { logoUrl: url })
      if (organization) setOrganization({ ...organization, logoUrl: url })
      toast.success('Logo actualizado correctamente')
    } catch (err: unknown) {
      const msg = (err as { message?: string; code?: string }).message ?? 'Error al subir el logo'
      const code = (err as { code?: string }).code ?? ''
      if (code === 'storage/unauthorized') {
        toast.error('Sin permisos para subir el logo. Verifica las reglas de Firebase Storage.')
      } else if (code === 'storage/unknown' || code === 'storage/retry-limit-exceeded') {
        toast.error('Error de conexión. Inténtalo de nuevo.')
      } else {
        toast.error(msg)
      }
    } finally {
      setLogoUploading(false)
      setUploadProgress(0)
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
          <div className="space-y-3">
            <Label>Logotipo</Label>
            {organization?.logoUrl ? (
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 h-16 w-16 rounded-xl border border-white/15 bg-white/5 flex items-center justify-center overflow-hidden p-1">
                  <img
                    src={organization.logoUrl}
                    alt="Logo"
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="flex gap-2">
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/8 text-sm text-gray-300 transition-colors">
                      <Upload size={13} />
                      Cambiar
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={uploadLogo}
                      disabled={logoUploading}
                    />
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                    onClick={removeLogo}
                    disabled={logoUploading}
                  >
                    <X size={13} /> Eliminar
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <label className={`flex items-center gap-3 ${logoUploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                  <div className={`flex flex-col items-center justify-center gap-2 w-full py-8 rounded-xl border-2 border-dashed transition-colors ${
                    logoUploading
                      ? 'border-white/10 bg-white/3'
                      : 'border-white/15 bg-white/3 hover:bg-white/6 hover:border-white/25'
                  }`}>
                    {logoUploading ? (
                      <>
                        <div className="h-8 w-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
                        <p className="text-sm text-gray-400">Subiendo... {uploadProgress}%</p>
                        <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 rounded-full transition-all"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center">
                          <ImageIcon size={20} className="text-gray-500" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm text-gray-300 flex items-center gap-1.5 justify-center">
                            <Upload size={13} /> Subir logotipo
                          </p>
                          <p className="text-xs text-gray-600 mt-1">PNG, JPG, SVG · máx 2 MB</p>
                        </div>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={uploadLogo}
                    disabled={logoUploading}
                  />
                </label>
              </div>
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
