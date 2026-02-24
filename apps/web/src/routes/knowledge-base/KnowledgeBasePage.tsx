import { useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { Database, Plus, Trash2, Upload, X, FileSpreadsheet } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import {
  useKnowledgeBases,
  useImportKnowledgeBase,
  useDeleteKnowledgeBase,
} from '@/features/knowledge-base/hooks/use-knowledge-base'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { KnowledgeBase } from '@/types'

interface ParsedFile {
  fileName: string
  sheets: string[]
  activeSheet: number
  rows: Record<string, unknown>[]
  columns: string[]
  allData: Record<number, { rows: Record<string, unknown>[]; columns: string[] }>
}

// ─── Upload Dialog ─────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onOpenChange,
  orgId,
  editKb,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string | undefined
  editKb: KnowledgeBase | null
}) {
  const importKB = useImportKnowledgeBase()
  const [name, setName] = useState(editKb?.name ?? '')
  const [description, setDescription] = useState(editKb?.description ?? '')
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function processFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result
      const workbook = XLSX.read(data, { type: 'array' })
      const allData: ParsedFile['allData'] = {}
      workbook.SheetNames.forEach((sheetName, i) => {
        const ws = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        allData[i] = {
          rows: json,
          columns: json.length > 0 ? Object.keys(json[0]) : [],
        }
      })
      setParsed({
        fileName: file.name,
        sheets: workbook.SheetNames,
        activeSheet: 0,
        rows: allData[0]?.rows ?? [],
        columns: allData[0]?.columns ?? [],
        allData,
      })
      if (!name && editKb === null) {
        setName(file.name.replace(/\.[^.]+$/, ''))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    processFile(files[0])
  }

  function selectSheet(i: number) {
    if (!parsed) return
    setParsed({ ...parsed, activeSheet: i, ...parsed.allData[i] })
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [])

  async function handleImport() {
    if (!parsed || !orgId || !name.trim()) return
    await importKB.mutateAsync({
      kbId: editKb?.id,
      name: name.trim(),
      description: description.trim(),
      orgId,
      rows: parsed.rows,
      columns: parsed.columns,
    })
    onOpenChange(false)
    setParsed(null)
    setName('')
    setDescription('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importKB.isPending) { onOpenChange(o); setParsed(null) } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editKb ? 'Actualizar Base de Datos' : 'Subir Base de Datos'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Catálogo de Productos, Lista de Precios..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="¿Qué información contiene?"
              />
            </div>
          </div>

          {/* Drop zone */}
          {!parsed && (
            <div
              className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-brand-500 bg-brand-600/5' : 'border-white/15 hover:border-white/25'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <FileSpreadsheet size={32} className="mx-auto text-gray-600 mb-3" />
              <p className="text-sm text-gray-400">Arrastra tu archivo Excel aquí o haz clic para seleccionar</p>
              <p className="text-xs text-gray-600 mt-1">Formatos: .xlsx, .xls, .csv (máx 5MB)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          )}

          {/* File info & preview */}
          {parsed && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <FileSpreadsheet size={20} className="text-green-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{parsed.fileName}</p>
                  <p className="text-xs text-gray-500">
                    {parsed.rows.length} filas · {parsed.columns.length} columnas
                  </p>
                </div>
                <button
                  onClick={() => setParsed(null)}
                  className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/10"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Sheet selector */}
              {parsed.sheets.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {parsed.sheets.map((sheet, i) => (
                    <button
                      key={sheet}
                      onClick={() => selectSheet(i)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        parsed.activeSheet === i
                          ? 'border-brand-500 bg-brand-600/15 text-brand-300'
                          : 'border-white/15 text-gray-400 hover:bg-white/5'
                      }`}
                    >
                      {sheet}
                    </button>
                  ))}
                </div>
              )}

              {/* Preview table */}
              <div className="rounded-xl border border-white/10 overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/8 sticky top-0">
                    <tr>
                      {parsed.columns.slice(0, 8).map((col) => (
                        <th key={col} className="px-3 py-2 text-left text-gray-400 font-medium whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                      {parsed.columns.length > 8 && (
                        <th className="px-3 py-2 text-gray-600">+{parsed.columns.length - 8} más</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {parsed.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="hover:bg-white/3">
                        {parsed.columns.slice(0, 8).map((col) => (
                          <td key={col} className="px-3 py-1.5 text-gray-300 truncate max-w-[120px]">
                            {String(row[col] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-600">Mostrando 5 de {parsed.rows.length} filas</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { onOpenChange(false); setParsed(null) }}
            disabled={importKB.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!parsed || !name.trim()}
            loading={importKB.isPending}
          >
            <Upload size={13} />
            {editKb ? 'Actualizar' : 'Importar Base de Datos'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function KnowledgeBasePage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? organization?.id

  const { data: kbs = [], isLoading } = useKnowledgeBases(orgId)
  const deleteKB = useDeleteKnowledgeBase(orgId)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [editKb, setEditKb] = useState<KnowledgeBase | null>(null)

  function openUpload(kb: KnowledgeBase | null = null) {
    setEditKb(kb)
    setUploadOpen(true)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">
            {kbs.length} {kbs.length === 1 ? 'base de datos' : 'bases de datos'}
          </p>
        </div>
        <Button onClick={() => openUpload()}>
          <Plus size={14} /> Nueva Base de Datos
        </Button>
      </div>

      {isLoading && (
        <div className="py-16 text-center text-gray-600 animate-pulse">Cargando...</div>
      )}

      {!isLoading && kbs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Database size={48} className="text-gray-700" />
          <div className="text-center">
            <p className="font-medium text-gray-400">Sin bases de datos</p>
            <p className="text-sm text-gray-600 mt-1">
              Sube un archivo Excel o CSV para que tus agentes IA puedan consultarlo
            </p>
          </div>
          <Button onClick={() => openUpload()}>
            <Upload size={14} /> Subir primer archivo
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kbs.map((kb) => (
          <div
            key={kb.id}
            className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 hover:border-white/20 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="h-9 w-9 rounded-xl bg-green-600/15 flex items-center justify-center shrink-0">
                <FileSpreadsheet size={18} className="text-green-400" />
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openUpload(kb)}
                  title="Actualizar datos"
                >
                  <Upload size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-gray-500 hover:text-red-400"
                  onClick={() => {
                    if (confirm(`¿Eliminar "${kb.name}"?`)) {
                      deleteKB.mutate(kb.id)
                    }
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
            <div>
              <p className="font-medium text-white">{kb.name}</p>
              {kb.description && (
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{kb.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {kb.rowCount != null && (
                <Badge variant="secondary">{kb.rowCount.toLocaleString()} filas</Badge>
              )}
              {kb.columns && kb.columns.length > 0 && (
                <Badge variant="secondary">{kb.columns.length} columnas</Badge>
              )}
            </div>
            {kb.columns && kb.columns.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {kb.columns.slice(0, 4).map((col) => (
                  <span key={col} className="text-xs text-gray-600 bg-white/5 px-2 py-0.5 rounded border border-white/8">
                    {col}
                  </span>
                ))}
                {kb.columns.length > 4 && (
                  <span className="text-xs text-gray-700">+{kb.columns.length - 4}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={(o) => { setUploadOpen(o); if (!o) setEditKb(null) }}
        orgId={orgId}
        editKb={editKb}
      />
    </div>
  )
}
