import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, SelectField, TextField, TextareaField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate, useApi } from '@/hooks/useApi'
import { membersApi, trainersApi } from '@/services/endpoints'
import { emptyMember, memberPayload, memberSchema, type MemberValues } from '@/schemas/member'
import type { Credentials, MemberWorkspace } from '@/types'
import { applyServerErrors } from '@/utils/forms'
import { todayISO } from '@/utils/format'

interface MemberFormDialogProps {
  open: boolean
  onClose: () => void
  member?: MemberWorkspace | null
  onCreated?: (member: MemberWorkspace, credentials: Credentials | null) => void
  onSaved?: (member: MemberWorkspace) => void
}

function toValues(member?: MemberWorkspace | null): MemberValues {
  if (!member) return { ...emptyMember, joining_date: todayISO() }
  return {
    name: member.name,
    phone: member.phone,
    email: member.email ?? '',
    gender: (member.gender ?? '') as MemberValues['gender'],
    date_of_birth: member.date_of_birth ?? '',
    address: member.address ?? '',
    emergency_contact: member.emergency_contact ?? '',
    trainer_id: member.trainer ? String(member.trainer.id) : '',
    joining_date: member.joining_date,
    create_app_login: false,
  }
}

export function MemberFormDialog({ open, onClose, member, onCreated, onSaved }: MemberFormDialogProps) {
  const toast = useToast()
  const editing = !!member
  const trainers = useApi(open ? 'trainers:active' : null, () => trainersApi.list('ACTIVE'))
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MemberValues>({ resolver: zodResolver(memberSchema), defaultValues: toValues(member) })

  useEffect(() => {
    if (open) reset(toValues(member))
  }, [open, member, reset])

  const submit = handleSubmit(async (values) => {
    const { create_app_login, ...fields } = memberPayload(values)
    try {
      if (editing && member) {
        const saved = await membersApi.update(member.id, { ...fields, joining_date: values.joining_date || member.joining_date })
        invalidate('members', `member:${member.id}`)
        toast.success('Member updated')
        onSaved?.(saved)
        onClose()
      } else {
        const created = await membersApi.create({ ...fields, create_app_login })
        invalidate('members', 'dashboard')
        toast.success(`${created.member.name} added`, { description: `Member ID ${created.member.member_code}` })
        onClose()
        onCreated?.(created.member, created.credentials)
      }
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  const trainerOptions = (trainers.data?.items ?? []).map((t) => ({ value: t.id, label: t.specialization ? `${t.name} · ${t.specialization}` : t.name }))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Edit member' : 'Add member'}
      description={editing ? member?.member_code : 'A member ID is generated automatically.'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="member-form" loading={isSubmitting} icon={editing ? undefined : UserPlus}>
            {editing ? 'Save changes' : 'Add member'}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <TextField label="Full name" required autoComplete="off" placeholder="e.g. Aarav Sharma" error={errors.name?.message} {...register('name')} data-autofocus />
        <TextField label="Mobile number" required type="tel" inputMode="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
        <TextField label="Email" type="email" inputMode="email" placeholder="name@example.com" error={errors.email?.message} {...register('email')} />
        <SelectField
          label="Gender"
          placeholder="Prefer not to say"
          options={[
            { value: 'MALE', label: 'Male' },
            { value: 'FEMALE', label: 'Female' },
            { value: 'OTHER', label: 'Other' },
          ]}
          {...register('gender')}
        />
        <TextField label="Date of birth" type="date" max={todayISO()} error={errors.date_of_birth?.message} {...register('date_of_birth')} />
        <TextField label="Joining date" type="date" max={todayISO()} error={errors.joining_date?.message} {...register('joining_date')} />
        <SelectField label="Trainer" placeholder={trainers.loading ? 'Loading trainers…' : 'No trainer'} options={trainerOptions} {...register('trainer_id')} />
        <TextField label="Emergency contact" placeholder="Name & phone" error={errors.emergency_contact?.message} {...register('emergency_contact')} />
        <TextareaField label="Address" rows={2} wrapperClassName="sm:col-span-2" error={errors.address?.message} {...register('address')} />
        {!editing && (
          <div className="sm:col-span-2">
            <Checkbox
              label="Create member app login"
              description="Creates a one-time password so the member can see their membership, check-in QR and workouts, and renew with UPI."
              {...register('create_app_login')}
            />
          </div>
        )}
      </form>
    </Dialog>
  )
}
