import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import type { Order, OrderStatus } from '@/types'

export function useOrders(orgId: string | undefined) {
  return useQuery({
    queryKey: ['orders', orgId],
    queryFn: async (): Promise<Order[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        query(collection(db, 'orders'), where('orgId', '==', orgId)),
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

export function useUpdateOrderStatus(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      await updateDoc(doc(db, 'orders', orderId), {
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
