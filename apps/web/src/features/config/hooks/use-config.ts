import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import type { AIAgent, IntegrationConfig, TeamMember } from '@/types'

// ─── Team ──────────────────────────────────────────────────────────────────────

export function useTeamMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: ['team', orgId],
    queryFn: async (): Promise<TeamMember[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        query(collection(db, 'users'), where('orgId', '==', orgId)),
      )
      // Also try organizationId for backwards compat
      const snap2 = await getDocs(
        query(collection(db, 'users'), where('organizationId', '==', orgId)),
      )
      const allDocs = [...snap.docs, ...snap2.docs]
      const seen = new Set<string>()
      return allDocs
        .filter((d) => {
          if (seen.has(d.id)) return false
          seen.add(d.id)
          return true
        })
        .map((d) => ({ uid: d.id, ...d.data() } as TeamMember))
    },
    enabled: !!orgId,
  })
}

// ─── AI Agents ─────────────────────────────────────────────────────────────────

export function useAIAgents(orgId: string | undefined) {
  return useQuery({
    queryKey: ['ai-agents', orgId],
    queryFn: async (): Promise<AIAgent[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        query(collection(db, 'aiAgents'), where('orgId', '==', orgId)),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AIAgent))
    },
    enabled: !!orgId,
  })
}

interface SaveAgentInput extends Omit<AIAgent, 'id' | 'createdAt'> {
  id?: string
}

export function useSaveAIAgent(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: SaveAgentInput) => {
      // Explicitly pick only valid agent fields — never persist org-level branding data
      const {
        name, provider, model, apiKey, endpoint,
        systemPrompt, knowledgeBases, channels, active,
        orgId: agentOrgId,
      } = data
      const agentPayload: Record<string, unknown> = {
        name, provider, model, endpoint: endpoint ?? '',
        systemPrompt, knowledgeBases: knowledgeBases ?? [],
        channels: channels ?? [], active,
        orgId: agentOrgId,
      }
      // Only include apiKey when it is explicitly provided (non-empty string)
      if (apiKey) agentPayload.apiKey = apiKey

      if (id) {
        await updateDoc(doc(db, 'aiAgents', id), { ...agentPayload, updatedAt: serverTimestamp() })
      } else {
        await addDoc(collection(db, 'aiAgents'), { ...agentPayload, createdAt: serverTimestamp() })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agents', orgId] })
      toast.success('Agente guardado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteAIAgent(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'aiAgents', id))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agents', orgId] })
      toast.success('Agente eliminado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ─── Integrations ──────────────────────────────────────────────────────────────

export function useIntegrations(orgId: string | undefined) {
  return useQuery({
    queryKey: ['integrations', orgId],
    queryFn: async (): Promise<IntegrationConfig[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        query(collection(db, 'integrations'), where('orgId', '==', orgId)),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as IntegrationConfig))
    },
    enabled: !!orgId,
  })
}

// All IntegrationConfig fields are already typed correctly (including the new
// method / evolutionApi* fields added to the schema), so we just re-use them.
interface SaveIntegrationInput extends Omit<IntegrationConfig, 'id'> {
  id?: string
}

export function useSaveIntegration(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: SaveIntegrationInput) => {
      if (id) {
        await updateDoc(doc(db, 'integrations', id), { ...data, updatedAt: serverTimestamp() })
      } else {
        await addDoc(collection(db, 'integrations'), { ...data, updatedAt: serverTimestamp() })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', orgId] })
      toast.success('Integración guardada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteIntegration(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'integrations', id))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations', orgId] })
      toast.success('Integración eliminada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
