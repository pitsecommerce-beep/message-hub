import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import type { Contact, FunnelStage } from '@/types'

export function useContacts(orgId: string | undefined) {
  return useQuery({
    queryKey: ['contacts', orgId],
    queryFn: async (): Promise<Contact[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        collection(db, 'organizations', orgId, 'contacts'),
      )
      // Sort client-side to avoid requiring a Firestore composite index
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contact))
      docs.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0
        const tb = b.createdAt?.toMillis?.() ?? 0
        return tb - ta
      })
      return docs
    },
    enabled: !!orgId,
  })
}

interface CreateContactInput {
  name: string
  company?: string
  phone?: string
  email?: string
  rfc?: string
  address?: string
  notes?: string
  funnelStage?: FunnelStage
}

// Firestore rejects fields with undefined values — strip them before writing
function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>
}

export function useCreateContact(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      if (!orgId) throw new Error('No orgId')
      await addDoc(collection(db, 'organizations', orgId, 'contacts'), {
        ...stripUndefined(input),
        createdAt: serverTimestamp(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', orgId] })
      toast.success('Contacto creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

interface UpdateContactInput extends Partial<CreateContactInput> {
  id: string
}

export function useUpdateContact(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateContactInput) => {
      if (!orgId) throw new Error('No orgId')
      await updateDoc(doc(db, 'organizations', orgId, 'contacts', id), {
        ...stripUndefined(data),
        updatedAt: serverTimestamp(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', orgId] })
      toast.success('Contacto actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteContact(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!orgId) throw new Error('No orgId')
      await deleteDoc(doc(db, 'organizations', orgId, 'contacts', id))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', orgId] })
      toast.success('Contacto eliminado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateFunnelStage(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: FunnelStage }) => {
      if (!orgId) throw new Error('No orgId')
      await updateDoc(doc(db, 'organizations', orgId, 'contacts', id), {
        funnelStage: stage,
        funnelUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
