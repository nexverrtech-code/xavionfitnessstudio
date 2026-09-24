import { useState } from 'react'
import { CredentialsDialog } from '@/components/members/CredentialsDialog'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { trainersApi } from '@/services/endpoints'
import type { Credentials, Trainer } from '@/types'

/** Shared trainer actions (login creation, activate / deactivate) with their dialogs. */
export function useTrainerActions() {
  const toast = useToast()
  const [credentials, setCredentials] = useState<{ credentials: Credentials; name: string } | null>(null)
  const [toggling, setToggling] = useState<Trainer | null>(null)

  const createLogin = async (trainer: Trainer) => {
    try {
      setCredentials({ credentials: await trainersApi.account(trainer.id), name: trainer.name })
      invalidate('trainers', `trainer:${trainer.id}`)
    } catch (error) {
      toast.fromError(error)
    }
  }

  const dialogs = (
    <>
      <CredentialsDialog credentials={credentials?.credentials ?? null} subject={credentials?.name} title="Trainer login ready" onClose={() => setCredentials(null)} />
      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        title={toggling?.status === 'ACTIVE' ? `Deactivate ${toggling?.name}?` : `Activate ${toggling?.name}?`}
        message={
          toggling?.status === 'ACTIVE'
            ? 'Their login is disabled immediately. Assigned members keep their workouts and can be reassigned.'
            : 'The trainer can be assigned members again. Create a new login if they need access.'
        }
        confirmLabel={toggling?.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
        tone={toggling?.status === 'ACTIVE' ? 'danger' : 'primary'}
        onConfirm={async () => {
          try {
            await trainersApi.setStatus(toggling!.id, toggling!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
            invalidate('trainers', `trainer:${toggling!.id}`)
            toast.success(toggling!.status === 'ACTIVE' ? 'Trainer deactivated' : 'Trainer activated')
          } catch (error) {
            toast.fromError(error)
            throw error
          }
        }}
      />
    </>
  )
  return { createLogin, toggle: setToggling, dialogs }
}
