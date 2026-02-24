import { useState } from 'react'
import { Users, Copy, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app.store'
import { useTeamMembers } from '@/features/config/hooks/use-config'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  manager: 'Gerente',
  agente: 'Agente',
  agent: 'Agente',
}

const ROLE_VARIANTS: Record<string, 'default' | 'warning' | 'info' | 'secondary'> = {
  admin: 'default',
  gerente: 'warning',
  manager: 'warning',
  agente: 'info',
  agent: 'info',
}

export default function TeamPage() {
  const { userData, organization } = useAppStore()
  const orgId = userData?.orgId ?? (userData as { organizationId?: string })?.organizationId ?? organization?.id
  const { data: members = [], isLoading } = useTeamMembers(orgId)
  const [inviteOpen, setInviteOpen] = useState(false)

  const inviteCode = organization?.inviteCode ?? '—'

  function copyCode() {
    navigator.clipboard.writeText(inviteCode)
    toast.success('Código copiado')
  }

  return (
    <div className="space-y-5">
      {/* Invite section */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-white">Invitar a tu equipo</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Comparte este código con nuevos miembros para que se unan como agentes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-white/15 bg-white/8 px-4 py-2 font-mono text-sm font-semibold text-white tracking-widest">
            {inviteCode}
          </div>
          <Button variant="outline" size="icon" onClick={copyCode}>
            <Copy size={14} />
          </Button>
        </div>
      </div>

      {/* Members count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {isLoading ? '…' : `${members.length} miembros`}
        </p>
      </div>

      {/* Members table */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr>
              {['Miembro', 'Correo', 'Rol'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading && (
              <tr>
                <td colSpan={3} className="py-10 text-center text-gray-600 animate-pulse">Cargando...</td>
              </tr>
            )}
            {!isLoading && members.length === 0 && (
              <tr>
                <td colSpan={3} className="py-10 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Users size={32} className="text-gray-700" />
                    <p className="text-gray-600">Sin miembros del equipo</p>
                  </div>
                </td>
              </tr>
            )}
            {members.map((member) => (
              <tr key={member.uid} className="hover:bg-white/3 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 text-sm font-semibold shrink-0">
                      {member.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{member.name}</p>
                      {member.uid === userData?.uid && (
                        <p className="text-xs text-gray-600">Tú</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">{member.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={ROLE_VARIANTS[member.role] ?? 'secondary'}>
                    {ROLE_LABELS[member.role] ?? member.role}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
