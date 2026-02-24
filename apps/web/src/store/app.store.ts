import { create } from 'zustand'
import type { UserData, Organization } from '@/types'

interface AppState {
  // Auth
  userData: UserData | null
  organization: Organization | null
  setUserData: (data: UserData | null) => void
  setOrganization: (org: Organization | null) => void

  // UI
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  // Notifications panel
  notifPanelOpen: boolean
  setNotifPanelOpen: (open: boolean) => void

  // Search
  searchQuery: string
  setSearchQuery: (q: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  // Auth
  userData: null,
  organization: null,
  setUserData: (userData) => set({ userData }),
  setOrganization: (organization) => set({ organization }),

  // UI
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  // Notifications
  notifPanelOpen: false,
  setNotifPanelOpen: (notifPanelOpen) => set({ notifPanelOpen }),

  // Search
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}))
