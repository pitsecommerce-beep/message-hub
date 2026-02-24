import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { MessageSquare } from 'lucide-react'
import { auth, db } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
})

const registerSchema = z.object({
  name: z.string().min(2, 'Ingresa tu nombre completo'),
  email: z.string().email('Correo inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})

type LoginForm = z.infer<typeof loginSchema>
type RegisterForm = z.infer<typeof registerSchema>

function getFirebaseError(code: string): string {
  const map: Record<string, string> = {
    'auth/user-not-found': 'No existe una cuenta con este correo.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/email-already-in-use': 'Este correo ya está registrado.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana emergente.',
    'auth/popup-closed-by-user': '',
  }
  return map[code] ?? 'Error de autenticación. Intenta de nuevo.'
}

// ─── Login Tab ─────────────────────────────────────────────────────────────────

function LoginTab() {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(data: LoginForm) {
    try {
      await signInWithEmailAndPassword(auth, data.email, data.password)
      navigate('/')
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? ''
      const msg = getFirebaseError(code)
      if (msg) toast.error(msg)
    }
  }

  async function handleForgotPassword() {
    const email = getValues('email')
    if (!email) {
      toast.info('Ingresa tu correo antes de solicitar recuperación.')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email)
      toast.success(`Enlace enviado a ${email}. Revisa tu bandeja de entrada.`)
    } catch {
      toast.error('No se pudo enviar el correo de recuperación.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="loginEmail">Correo electrónico</Label>
        <Input
          id="loginEmail"
          type="email"
          placeholder="tu@correo.com"
          autoComplete="email"
          {...register('email')}
        />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="loginPassword">Contraseña</Label>
        <Input
          id="loginPassword"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          {...register('password')}
        />
        {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
      </div>

      <button
        type="button"
        onClick={handleForgotPassword}
        className="text-xs text-brand-400 hover:text-brand-300 hover:underline"
      >
        ¿Olvidaste tu contraseña?
      </button>

      <Button type="submit" className="w-full" loading={isSubmitting}>
        Iniciar Sesión
      </Button>
    </form>
  )
}

// ─── Register Tab ─────────────────────────────────────────────────────────────

function RegisterTab() {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) })

  async function onSubmit(data: RegisterForm) {
    // Store pending registration in sessionStorage and navigate to onboarding
    sessionStorage.setItem('pendingRegistration', JSON.stringify(data))
    navigate('/onboarding')
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="registerName">Nombre completo</Label>
        <Input
          id="registerName"
          type="text"
          placeholder="Juan Pérez"
          autoComplete="name"
          {...register('name')}
        />
        {errors.name && <p className="text-xs text-red-400">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="registerEmail">Correo electrónico</Label>
        <Input
          id="registerEmail"
          type="email"
          placeholder="tu@correo.com"
          autoComplete="email"
          {...register('email')}
        />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="registerPassword">Contraseña</Label>
        <Input
          id="registerPassword"
          type="password"
          placeholder="Mínimo 6 caracteres"
          autoComplete="new-password"
          {...register('password')}
        />
        {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
      </div>

      <Button type="submit" className="w-full" loading={isSubmitting}>
        Crear Cuenta
      </Button>
    </form>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  const navigate = useNavigate()
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleGoogleAuth() {
    setGoogleLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(auth, provider)
      const userRef = doc(db, 'users', result.user.uid)
      const userSnap = await getDoc(userRef)
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          name: result.user.displayName ?? result.user.email?.split('@')[0] ?? 'Usuario',
          email: result.user.email,
          createdAt: serverTimestamp(),
          onboarded: false,
        })
        navigate('/onboarding')
      } else {
        navigate('/')
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? ''
      const msg = getFirebaseError(code)
      if (msg) toast.error(msg)
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      {/* Background decorative orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/8 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/25">
            <MessageSquare size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">MessageHub</h1>
            <p className="text-sm text-gray-500 mt-1">Plataforma de Mensajería Unificada</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 shadow-2xl">
          <Tabs defaultValue="login">
            <TabsList className="w-full mb-6">
              <TabsTrigger value="login" className="flex-1">Iniciar Sesión</TabsTrigger>
              <TabsTrigger value="register" className="flex-1">Crear Cuenta</TabsTrigger>
            </TabsList>
            <TabsContent value="login"><LoginTab /></TabsContent>
            <TabsContent value="register"><RegisterTab /></TabsContent>
          </Tabs>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-gray-900/80 px-2 text-gray-500">o continúa con</span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleAuth}
            loading={googleLoading}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google
          </Button>
        </div>
      </div>
    </div>
  )
}
