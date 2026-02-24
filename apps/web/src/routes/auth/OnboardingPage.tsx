import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import {
  doc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Building2, Users, ArrowLeft, MessageSquare } from 'lucide-react'
import { auth, db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type Role = 'gerente' | 'agente'

function generateOrgId() {
  return 'org_' + Math.random().toString(36).slice(2, 10)
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${part(5)}-${part(5)}`
}

// ─── Step 1: Role selection ────────────────────────────────────────────────────

interface Step1Props {
  selectedRole: Role | null
  onSelect: (r: Role) => void
  onNext: () => void
  onBack: () => void
}

function Step1({ selectedRole, onSelect, onNext, onBack }: Step1Props) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white">¿Cuál es tu rol?</h2>
        <p className="text-sm text-gray-400 mt-1">Esto determinará tus permisos dentro de la plataforma</p>
      </div>

      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => onSelect('gerente')}
          className={cn(
            'flex items-start gap-4 p-4 rounded-xl border text-left transition-all',
            selectedRole === 'gerente'
              ? 'border-brand-500 bg-brand-600/15'
              : 'border-white/15 bg-white/5 hover:bg-white/8',
          )}
        >
          <div className="h-10 w-10 rounded-lg bg-brand-600/20 flex items-center justify-center shrink-0 mt-0.5">
            <Building2 size={18} className="text-brand-400" />
          </div>
          <div>
            <p className="font-medium text-white">Gerente / Dueño</p>
            <p className="text-sm text-gray-400 mt-0.5">
              Crea y administra tu organización, integra canales y gestiona el equipo.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onSelect('agente')}
          className={cn(
            'flex items-start gap-4 p-4 rounded-xl border text-left transition-all',
            selectedRole === 'agente'
              ? 'border-brand-500 bg-brand-600/15'
              : 'border-white/15 bg-white/5 hover:bg-white/8',
          )}
        >
          <div className="h-10 w-10 rounded-lg bg-purple-600/20 flex items-center justify-center shrink-0 mt-0.5">
            <Users size={18} className="text-purple-400" />
          </div>
          <div>
            <p className="font-medium text-white">Agente</p>
            <p className="text-sm text-gray-400 mt-0.5">
              Únete al equipo de tu empresa con un código de invitación y atiende conversaciones.
            </p>
          </div>
        </button>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          <ArrowLeft size={14} /> Cancelar
        </Button>
        <Button className="flex-1" disabled={!selectedRole} onClick={onNext}>
          Continuar
        </Button>
      </div>
    </div>
  )
}

// ─── Step 2A: Manager setup ────────────────────────────────────────────────────

const orgSchema = z.object({
  orgName: z.string().min(2, 'Ingresa el nombre de la organización'),
  industry: z.string().optional(),
})
type OrgForm = z.infer<typeof orgSchema>

interface ManagerSetupProps {
  onBack: () => void
  onComplete: () => void
}

function ManagerSetup({ onBack, onComplete }: ManagerSetupProps) {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OrgForm>({ resolver: zodResolver(orgSchema) })

  async function onSubmit(data: OrgForm) {
    const pending = sessionStorage.getItem('pendingRegistration')
    let uid: string
    let userName: string
    let userEmail: string

    try {
      if (pending) {
        const { name, email, password } = JSON.parse(pending) as {
          name: string; email: string; password: string
        }
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(cred.user, { displayName: name })
        uid = cred.user.uid
        userName = name
        userEmail = email
      } else {
        const user = auth.currentUser
        if (!user) throw new Error('No hay usuario autenticado')
        uid = user.uid
        userName = user.displayName ?? user.email?.split('@')[0] ?? 'Usuario'
        userEmail = user.email ?? ''
      }

      const orgId = generateOrgId()
      const inviteCode = generateInviteCode()

      await setDoc(doc(db, 'organizations', orgId), {
        name: data.orgName,
        industry: data.industry ?? '',
        ownerId: uid,
        inviteCode,
        createdAt: serverTimestamp(),
        members: [uid],
        integrations: {
          whatsapp: false,
          instagram: false,
          messenger: false,
          stripe: false,
          mercadopago: false,
        },
      })

      await setDoc(doc(db, 'users', uid), {
        name: userName,
        email: userEmail,
        orgId,
        organizationId: orgId,
        role: 'gerente',
        onboarded: true,
        createdAt: serverTimestamp(),
      })

      sessionStorage.removeItem('pendingRegistration')
      toast.success(
        `Organización "${data.orgName}" creada. Código de invitación: ${inviteCode}`,
      )
      onComplete()
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as Error).message ?? 'Error al crear la organización'
      toast.error(msg)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white">Crea tu Organización</h2>
        <p className="text-sm text-gray-400 mt-1">Configura el espacio de trabajo para tu equipo</p>
      </div>

      <div className="space-y-1.5">
        <Label>Nombre de la organización *</Label>
        <Input placeholder="Mi Empresa S.A." {...register('orgName')} />
        {errors.orgName && <p className="text-xs text-red-400">{errors.orgName.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label>Industria (opcional)</Label>
        <Input placeholder="Ej: Comercio, Servicios, Tecnología..." {...register('industry')} />
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          <ArrowLeft size={14} /> Atrás
        </Button>
        <Button type="submit" className="flex-1" loading={isSubmitting}>
          Crear Organización
        </Button>
      </div>
    </form>
  )
}

// ─── Step 2B: Agent setup ──────────────────────────────────────────────────────

const joinSchema = z.object({
  inviteCode: z.string().min(5, 'Ingresa el código de invitación'),
})
type JoinForm = z.infer<typeof joinSchema>

interface AgentSetupProps {
  onBack: () => void
  onComplete: () => void
}

function AgentSetup({ onBack, onComplete }: AgentSetupProps) {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<JoinForm>({ resolver: zodResolver(joinSchema) })

  async function onSubmit(data: JoinForm) {
    const code = data.inviteCode.trim().toUpperCase().replace(/\s/g, '')
    const pending = sessionStorage.getItem('pendingRegistration')
    let uid: string
    let userName: string
    let userEmail: string
    let userWasCreated = false

    try {
      if (pending) {
        const { name, email, password } = JSON.parse(pending) as {
          name: string; email: string; password: string
        }
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(cred.user, { displayName: name })
        uid = cred.user.uid
        userName = name
        userEmail = email
        userWasCreated = true
      } else {
        const user = auth.currentUser
        if (!user) throw new Error('No hay usuario autenticado')
        uid = user.uid
        userName = user.displayName ?? user.email?.split('@')[0] ?? 'Usuario'
        userEmail = user.email ?? ''
      }

      const orgsRef = collection(db, 'organizations')
      const orgsQuery = query(orgsRef, where('inviteCode', '==', code))
      const orgsSnapshot = await getDocs(orgsQuery)

      if (orgsSnapshot.empty) {
        if (userWasCreated && auth.currentUser) {
          await auth.currentUser.delete().catch(() => {})
        }
        toast.error('Código de invitación no encontrado. Verifica con tu gerente.')
        sessionStorage.removeItem('pendingRegistration')
        return
      }

      const orgDoc = orgsSnapshot.docs[0]
      const orgId = orgDoc.id
      const orgData = orgDoc.data()

      await updateDoc(doc(db, 'organizations', orgId), {
        members: arrayUnion(uid),
      })

      await setDoc(doc(db, 'users', uid), {
        name: userName,
        email: userEmail,
        orgId,
        organizationId: orgId,
        role: 'agente',
        onboarded: true,
        createdAt: serverTimestamp(),
      })

      sessionStorage.removeItem('pendingRegistration')
      toast.success(`Te uniste a "${orgData.name}". ¡Bienvenido!`)
      onComplete()
      navigate('/')
    } catch (err: unknown) {
      if (userWasCreated && auth.currentUser) {
        await auth.currentUser.delete().catch(() => {})
      }
      const msg = (err as Error).message ?? 'Error al unirse a la organización'
      toast.error(msg)
      sessionStorage.removeItem('pendingRegistration')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white">Únete al Equipo</h2>
        <p className="text-sm text-gray-400 mt-1">Ingresa el código de invitación de tu gerente</p>
      </div>

      <div className="space-y-1.5">
        <Label>Código de invitación *</Label>
        <Input
          placeholder="XXXXX-XXXXX"
          className="uppercase tracking-widest text-center text-lg"
          {...register('inviteCode')}
        />
        {errors.inviteCode && <p className="text-xs text-red-400">{errors.inviteCode.message}</p>}
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          <ArrowLeft size={14} /> Atrás
        </Button>
        <Button type="submit" className="flex-1" loading={isSubmitting}>
          Unirse a la Organización
        </Button>
      </div>
    </form>
  )
}

// ─── Main Onboarding Page ─────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2>(1)
  const [role, setRole] = useState<Role | null>(null)

  function handleBack() {
    if (step === 1) {
      sessionStorage.removeItem('pendingRegistration')
      navigate('/login')
    } else {
      setStep(1)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-72 h-72 bg-brand-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-purple-600/6 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/25">
            <MessageSquare size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">MessageHub</h1>
            <p className="text-sm text-gray-500 mt-1">Configura tu cuenta</p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={cn(
                'h-1.5 w-8 rounded-full transition-colors',
                s <= step ? 'bg-brand-500' : 'bg-white/15',
              )}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 shadow-2xl">
          {step === 1 && (
            <Step1
              selectedRole={role}
              onSelect={setRole}
              onNext={() => setStep(2)}
              onBack={handleBack}
            />
          )}
          {step === 2 && role === 'gerente' && (
            <ManagerSetup onBack={() => setStep(1)} onComplete={() => {}} />
          )}
          {step === 2 && role === 'agente' && (
            <AgentSetup onBack={() => setStep(1)} onComplete={() => {}} />
          )}
        </div>
      </div>
    </div>
  )
}
