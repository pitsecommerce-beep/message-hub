import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  query,
  orderBy,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import type { Conversation, Message, FunnelStage, Platform } from '@/types'

export function useConversations(orgId: string | undefined) {
  return useQuery({
    queryKey: ['conversations', orgId],
    queryFn: async (): Promise<Conversation[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        collection(db, 'organizations', orgId, 'conversations'),
      )
      // Sort client-side by lastMessageAt desc to avoid requiring a composite index
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), orgId } as Conversation))
      docs.sort((a, b) => {
        const ta = a.lastMessageAt instanceof Timestamp ? a.lastMessageAt.toMillis() : 0
        const tb = b.lastMessageAt instanceof Timestamp ? b.lastMessageAt.toMillis() : 0
        return tb - ta
      })
      return docs
    },
    enabled: !!orgId,
  })
}

export function useMessages(orgId: string | undefined, convId: string | undefined) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId || !convId) {
      setLoading(false)
      return
    }

    const q = query(
      collection(db, 'organizations', orgId, 'conversations', convId, 'messages'),
      orderBy('timestamp', 'asc'),
    )

    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)))
      setLoading(false)
    })

    return unsub
  }, [orgId, convId])

  return { messages, loading }
}

interface SendMessageInput {
  convId: string
  text: string
  senderName: string
  role: 'agent'
}

export function useSendMessage(orgId: string | undefined) {
  return useMutation({
    mutationFn: async ({ convId, text, senderName, role }: SendMessageInput) => {
      if (!orgId) throw new Error('No orgId')
      await addDoc(collection(db, 'organizations', orgId, 'conversations', convId, 'messages'), {
        text,
        senderName,
        role,
        timestamp: serverTimestamp(),
      })
      await updateDoc(doc(db, 'organizations', orgId, 'conversations', convId), {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
      })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteConversation(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (convId: string) => {
      if (!orgId) throw new Error('No orgId')
      await deleteDoc(doc(db, 'organizations', orgId, 'conversations', convId))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations', orgId] })
      toast.success('Conversación eliminada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateConvStage(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ convId, stage }: { convId: string; stage: FunnelStage }) => {
      if (!orgId) throw new Error('No orgId')
      await updateDoc(doc(db, 'organizations', orgId, 'conversations', convId), {
        funnelStage: stage,
        updatedAt: serverTimestamp(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useToggleConvAI(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ convId, enabled }: { convId: string; enabled: boolean }) => {
      if (!orgId) throw new Error('No orgId')
      await updateDoc(doc(db, 'organizations', orgId, 'conversations', convId), { aiEnabled: enabled })
    },
    onSuccess: (_, { enabled }) => {
      qc.invalidateQueries({ queryKey: ['conversations', orgId] })
      toast.success(enabled ? 'IA activada' : 'IA desactivada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

interface CreateConversationInput {
  contactId: string
  contactName: string
  contactPhone?: string
  platform: Platform
  orgId: string
  initialMessage?: string
  senderName: string
}

export function useCreateConversation(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      contactId, contactName, contactPhone, platform, orgId: org, initialMessage, senderName,
    }: CreateConversationInput) => {
      if (!org) throw new Error('No orgId')
      const convRef = await addDoc(collection(db, 'organizations', org, 'conversations'), {
        contactId,
        contactName,
        contactPhone: contactPhone ?? '',
        platform,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      })

      if (initialMessage) {
        await addDoc(collection(db, 'organizations', org, 'conversations', convRef.id, 'messages'), {
          text: initialMessage,
          senderName,
          role: 'agent',
          timestamp: serverTimestamp(),
        })
        await updateDoc(convRef, { lastMessage: initialMessage })
      }

      return convRef.id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations', orgId] })
      toast.success('Conversación iniciada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
