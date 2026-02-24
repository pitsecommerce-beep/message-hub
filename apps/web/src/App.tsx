import { lazy, Suspense } from 'react'
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Outlet,
} from 'react-router-dom'
import { ErrorBoundary } from 'react-error-boundary'
import { useAuth } from '@/hooks/use-auth'
import { useAppStore } from '@/store/app.store'
import AppShell from '@/components/layout/AppShell'
import LoadingScreen from '@/components/layout/LoadingScreen'
import ErrorScreen from '@/components/layout/ErrorScreen'

// Lazy-loaded pages
const LoginPage = lazy(() => import('@/routes/auth/LoginPage'))
const OnboardingPage = lazy(() => import('@/routes/auth/OnboardingPage'))
const DashboardPage = lazy(() => import('@/routes/dashboard/DashboardPage'))
const ConversationsPage = lazy(() => import('@/routes/conversations/ConversationsPage'))
const ContactsPage = lazy(() => import('@/routes/contacts/ContactsPage'))
const OrdersPage = lazy(() => import('@/routes/orders/OrdersPage'))
const KnowledgeBasePage = lazy(() => import('@/routes/knowledge-base/KnowledgeBasePage'))
const AgentsPage = lazy(() => import('@/routes/config/AgentsPage'))
const IntegrationsPage = lazy(() => import('@/routes/config/IntegrationsPage'))
const TeamPage = lazy(() => import('@/routes/config/TeamPage'))
const SettingsPage = lazy(() => import('@/routes/config/SettingsPage'))

// Auth guard wrapper
function AuthGuard() {
  const { user, userData, loading } = useAuth()
  const { setUserData } = useAppStore()

  // Sync to zustand when auth resolves
  if (!loading) {
    setUserData(userData)
  }

  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!userData) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

function PublicGuard() {
  const { user, userData, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (user && userData) return <Navigate to="/" replace />
  return <Outlet />
}

const router = createBrowserRouter([
  {
    element: <PublicGuard />,
    children: [
      { path: '/login', element: <Suspense fallback={<LoadingScreen />}><LoginPage /></Suspense> },
      { path: '/onboarding', element: <Suspense fallback={<LoadingScreen />}><OnboardingPage /></Suspense> },
    ],
  },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <Suspense fallback={<LoadingScreen />}><DashboardPage /></Suspense> },
          { path: '/conversations', element: <Suspense fallback={<LoadingScreen />}><ConversationsPage /></Suspense> },
          { path: '/contacts', element: <Suspense fallback={<LoadingScreen />}><ContactsPage /></Suspense> },
          { path: '/orders', element: <Suspense fallback={<LoadingScreen />}><OrdersPage /></Suspense> },
          { path: '/knowledge-base', element: <Suspense fallback={<LoadingScreen />}><KnowledgeBasePage /></Suspense> },
          { path: '/agents', element: <Suspense fallback={<LoadingScreen />}><AgentsPage /></Suspense> },
          { path: '/integrations', element: <Suspense fallback={<LoadingScreen />}><IntegrationsPage /></Suspense> },
          { path: '/team', element: <Suspense fallback={<LoadingScreen />}><TeamPage /></Suspense> },
          { path: '/settings', element: <Suspense fallback={<LoadingScreen />}><SettingsPage /></Suspense> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return (
    <ErrorBoundary FallbackComponent={ErrorScreen}>
      <RouterProvider router={router} />
    </ErrorBoundary>
  )
}
