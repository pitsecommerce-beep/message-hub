import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import type { Order, OrderStatus, OrderItem } from '@/types'

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>
}

function generateOrderNumber(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `PED-${yy}${mm}${dd}-${rand}`
}

interface CreateOrderInput {
  contactId: string
  contactName: string
  conversationId?: string
  status: OrderStatus
  items?: OrderItem[]
  total?: number
  notes?: string
}

export function useOrders(orgId: string | undefined) {
  return useQuery({
    queryKey: ['orders', orgId],
    queryFn: async (): Promise<Order[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        collection(db, 'organizations', orgId, 'orders'),
      )
      // Sort client-side to avoid requiring a Firestore composite index
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order))
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

export function useCreateOrder(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      if (!orgId) throw new Error('No orgId')
      const orderNumber = generateOrderNumber()
      await addDoc(collection(db, 'organizations', orgId, 'orders'), {
        ...stripUndefined(input),
        orderNumber,
        createdAt: serverTimestamp(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders', orgId] })
      toast.success('Pedido creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useOrder(orgId: string | undefined, orderId: string | undefined) {
  return useQuery({
    queryKey: ['orders', orgId, orderId],
    queryFn: async (): Promise<Order | null> => {
      if (!orgId || !orderId) return null
      const snap = await getDoc(doc(db, 'organizations', orgId, 'orders', orderId))
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() } as Order
    },
    enabled: !!orgId && !!orderId,
  })
}

export function useUpdateOrderStatus(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      if (!orgId) throw new Error('No orgId')
      await updateDoc(doc(db, 'organizations', orgId, 'orders', orderId), {
        status,
        updatedAt: serverTimestamp(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders', orgId] })
      toast.success('Estado actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
