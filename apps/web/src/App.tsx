import { QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/hooks/use-auth'

// Auth pages — loaded immediately (small, needed on first render)
const LoginPage = lazy(() => import('@/routes/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/routes/auth/RegisterPage'))
const OnboardingPage = lazy(() => import('@/routes/auth/OnboardingPage'))

// App pages — lazy loaded after auth
const DashboardPage = lazy(() => import('@/routes/app/DashboardPage'))
const ConversationsPage = lazy(() => import('@/routes/app/ConversationsPage'))
const ContactsPage = lazy(() => import('@/routes/app/ContactsPage'))
const OrdersPage = lazy(() => import('@/routes/app/OrdersPage'))
const KnowledgeBasePage = lazy(() => import('@/routes/app/KnowledgeBasePage'))
const AgentsPage = lazy(() => import('@/routes/app/AgentsPage'))
const IntegrationsPage = lazy(() => import('@/routes/app/IntegrationsPage'))
const TeamPage = lazy(() => import('@/routes/app/TeamPage'))

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (user) return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

function PageLoader() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0F0F23]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Redirect root to dashboard */}
            <Route path="/" element={<Navigate to="/app/dashboard" replace />} />

            {/* Public routes */}
            <Route path="/login" element={<GuestGuard><LoginPage /></GuestGuard>} />
            <Route path="/register" element={<GuestGuard><RegisterPage /></GuestGuard>} />
            <Route path="/onboarding" element={<AuthGuard><OnboardingPage /></AuthGuard>} />

            {/* Protected app routes */}
            <Route path="/app/dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
            <Route path="/app/conversations" element={<AuthGuard><ConversationsPage /></AuthGuard>} />
            <Route path="/app/conversations/:id" element={<AuthGuard><ConversationsPage /></AuthGuard>} />
            <Route path="/app/contacts" element={<AuthGuard><ContactsPage /></AuthGuard>} />
            <Route path="/app/orders" element={<AuthGuard><OrdersPage /></AuthGuard>} />
            <Route path="/app/knowledge-base" element={<AuthGuard><KnowledgeBasePage /></AuthGuard>} />
            <Route path="/app/agents" element={<AuthGuard><AgentsPage /></AuthGuard>} />
            <Route path="/app/integrations" element={<AuthGuard><IntegrationsPage /></AuthGuard>} />
            <Route path="/app/team" element={<AuthGuard><TeamPage /></AuthGuard>} />
          </Routes>
        </Suspense>
      </BrowserRouter>

      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  )
}
