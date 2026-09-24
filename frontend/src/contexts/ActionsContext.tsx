import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { CollectPaymentOptions } from '@/components/billing/CollectPaymentDialog'
import type { PaletteActions, PickAction } from '@/components/command/CommandPalette'
import { useHotkey } from '@/hooks/useUtilities'
import { invalidate } from '@/hooks/useApi'
import { attendanceApi } from '@/services/endpoints'
import type { Credentials, MemberListItem } from '@/types'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'

// Dialogs are code-split: they load the first time they are opened.
const CommandPalette = lazy(() => import('@/components/command/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const MemberFormDialog = lazy(() => import('@/components/members/MemberFormDialog').then((m) => ({ default: m.MemberFormDialog })))
const CredentialsDialog = lazy(() => import('@/components/members/CredentialsDialog').then((m) => ({ default: m.CredentialsDialog })))
const CollectPaymentDialog = lazy(() => import('@/components/billing/CollectPaymentDialog').then((m) => ({ default: m.CollectPaymentDialog })))
const ExpenseDialog = lazy(() => import('@/components/operations/ExpenseDialog').then((m) => ({ default: m.ExpenseDialog })))
const MeasurementDialog = lazy(() => import('@/components/training/MeasurementDialog').then((m) => ({ default: m.MeasurementDialog })))
const NotifyDialog = lazy(() => import('@/components/notifications/NotifyDialog').then((m) => ({ default: m.NotifyDialog })))
const WorkoutBuilder = lazy(() => import('@/components/training/WorkoutBuilder').then((m) => ({ default: m.WorkoutBuilder })))

interface MemberRef {
  id: number
  name?: string
}

interface Actions {
  openPalette: () => void
  addMember: () => void
  collectPayment: (options?: CollectPaymentOptions) => void
  addExpense: () => void
  addMeasurement: (member: MemberRef) => void
  sendNotification: (member: MemberRef) => void
  createWorkout: (member: MemberRef) => void
  markAttendance: (member: MemberRef) => Promise<void>
}

const ActionsContext = createContext<Actions | null>(null)

type Open =
  | { kind: 'palette' }
  | { kind: 'member' }
  | { kind: 'collect'; options: CollectPaymentOptions }
  | { kind: 'expense' }
  | { kind: 'measurement'; member: MemberRef }
  | { kind: 'notify'; member: MemberRef }
  | { kind: 'workout'; member: MemberRef }
  | null

export function ActionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState<Open>(null)
  const [credentials, setCredentials] = useState<{ credentials: Credentials; memberId: number; name: string } | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const isTeam = !!user && user.role !== 'MEMBER'

  useHotkey('mod+k', () => setOpen((current) => (current?.kind === 'palette' ? null : { kind: 'palette' })), { enabled: isTeam })

  const markAttendance = useCallback(
    async (member: MemberRef) => {
      try {
        const result = await attendanceApi.mark(member.id)
        invalidate(`member:${member.id}`, 'attendance', 'dashboard')
        if (result.ok) toast.success(result.message, { description: result.member?.name })
        else toast.warning(result.message, { description: result.member?.name })
      } catch (error) {
        toast.fromError(error)
      }
    },
    [toast],
  )

  const actions = useMemo<Actions>(
    () => ({
      openPalette: () => setOpen({ kind: 'palette' }),
      addMember: () => setOpen({ kind: 'member' }),
      collectPayment: (options = {}) => setOpen({ kind: 'collect', options }),
      addExpense: () => setOpen({ kind: 'expense' }),
      addMeasurement: (member) => setOpen({ kind: 'measurement', member }),
      sendNotification: (member) => setOpen({ kind: 'notify', member }),
      createWorkout: (member) => setOpen({ kind: 'workout', member }),
      markAttendance,
    }),
    [markAttendance],
  )

  const paletteActions = useMemo<PaletteActions>(
    () => ({
      addMember: actions.addMember,
      collectPayment: (memberId) => actions.collectPayment({ memberId }),
      addExpense: actions.addExpense,
      pick: (action: PickAction, member: MemberListItem) => {
        const ref = { id: member.id, name: member.name }
        if (action === 'workout') actions.createWorkout(ref)
        else if (action === 'measurement') actions.addMeasurement(ref)
        else if (action === 'renew') actions.collectPayment({ memberId: member.id })
        else void actions.markAttendance(ref)
      },
    }),
    [actions],
  )

  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <Suspense fallback={null}>
        {open?.kind === 'palette' && <CommandPalette open onClose={close} actions={paletteActions} />}
        {open?.kind === 'member' && (
          <MemberFormDialog
            open
            onClose={close}
            onCreated={(member, creds) => {
              if (creds) setCredentials({ credentials: creds, memberId: member.id, name: member.name })
              else navigate(`/members/${member.id}`)
            }}
          />
        )}
        {credentials && (
          <CredentialsDialog
            credentials={credentials.credentials}
            subject={credentials.name}
            onClose={() => {
              const memberId = credentials.memberId
              setCredentials(null)
              navigate(`/members/${memberId}`)
              toast.info('Next: add a membership', {
                action: { label: 'Collect payment', onClick: () => setOpen({ kind: 'collect', options: { memberId } }) },
              })
            }}
          />
        )}
        {open?.kind === 'collect' && <CollectPaymentDialog open onClose={close} {...open.options} />}
        {open?.kind === 'expense' && <ExpenseDialog open onClose={close} />}
        {open?.kind === 'measurement' && <MeasurementDialog open onClose={close} memberId={open.member.id} memberName={open.member.name} />}
        {open?.kind === 'notify' && <NotifyDialog open onClose={close} memberId={open.member.id} memberName={open.member.name} />}
        {open?.kind === 'workout' && <WorkoutBuilder open onClose={close} memberId={open.member.id} memberName={open.member.name} />}
      </Suspense>
    </ActionsContext.Provider>
  )
}

export function useActions(): Actions {
  const value = useContext(ActionsContext)
  if (!value) throw new Error('useActions must be used inside ActionsProvider')
  return value
}
