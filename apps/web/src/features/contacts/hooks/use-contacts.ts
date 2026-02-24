import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  orderBy,
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
        query(
          collection(db, 'contacts'),
          where('orgId', '==', orgId),
          orderBy('createdAt', 'desc'),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contact))
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

export function useCreateContact(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      if (!orgId) throw new Error('No orgId')
      await addDoc(collection(db, 'contacts'), {
        ...input,
        orgId,
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
      await updateDoc(doc(db, 'contacts', id), {
        ...data,
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
      await deleteDoc(doc(db, 'contacts', id))
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
      await updateDoc(doc(db, 'contacts', id), {
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
