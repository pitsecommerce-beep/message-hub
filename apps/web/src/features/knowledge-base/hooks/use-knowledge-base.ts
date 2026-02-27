import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  getDocs,
  doc,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import type { KnowledgeBase } from '@/types'

export function useKnowledgeBases(orgId: string | undefined) {
  return useQuery({
    queryKey: ['knowledge-bases', orgId],
    queryFn: async (): Promise<KnowledgeBase[]> => {
      if (!orgId) return []
      const snap = await getDocs(
        collection(db, 'organizations', orgId, 'knowledgeBases'),
      )
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as KnowledgeBase))
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

interface ImportKBInput {
  kbId?: string
  name: string
  description?: string
  orgId: string
  rows: Record<string, unknown>[]
  columns: string[]
}

export function useImportKnowledgeBase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ kbId, name, description, orgId, rows, columns }: ImportKBInput) => {
      const id = kbId ?? `kb_${Date.now()}`
      const kbRef = doc(db, 'organizations', orgId, 'knowledgeBases', id)

      await setDoc(kbRef, {
        name,
        description: description ?? '',
        rowCount: rows.length,
        columns,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Delete existing rows if updating
      if (kbId) {
        const existingSnap = await getDocs(collection(db, 'organizations', orgId, 'knowledgeBases', id, 'rows'))
        const deleteBatch = writeBatch(db)
        existingSnap.docs.forEach((d) => deleteBatch.delete(d.ref))
        await deleteBatch.commit()
      }

      // Write new rows in batches of 500
      const BATCH_SIZE = 500
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)
        rows.slice(i, i + BATCH_SIZE).forEach((row, j) => {
          const rowRef = doc(collection(db, 'organizations', orgId, 'knowledgeBases', id, 'rows'))
          batch.set(rowRef, { ...row, _rowIndex: i + j })
        })
        await batch.commit()
      }

      return id
    },
    onSuccess: (_, { orgId }) => {
      qc.invalidateQueries({ queryKey: ['knowledge-bases', orgId] })
      toast.success('Base de datos importada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteKnowledgeBase(orgId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (kbId: string) => {
      if (!orgId) throw new Error('No orgId')
      // Delete rows
      const rowsSnap = await getDocs(collection(db, 'organizations', orgId, 'knowledgeBases', kbId, 'rows'))
      const batch = writeBatch(db)
      rowsSnap.docs.forEach((d) => batch.delete(d.ref))
      batch.delete(doc(db, 'organizations', orgId, 'knowledgeBases', kbId))
      await batch.commit()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-bases', orgId] })
      toast.success('Base de datos eliminada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
