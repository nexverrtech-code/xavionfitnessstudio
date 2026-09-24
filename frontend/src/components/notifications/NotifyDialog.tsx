import { zodResolver } from '@hookform/resolvers/zod'
import { BellRing, Send } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextareaField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { invalidate } from '@/hooks/useApi'
import { notificationsApi } from '@/services/endpoints'
import { notifySchema, type NotifyValues } from '@/schemas/training'
import { applyServerErrors } from '@/utils/forms'

const MAX = 280

/** In-app message to one member (SmartGym sends no SMS, WhatsApp or email). Admin only. */
export function NotifyDialog({ open, onClose, memberId, memberName }: { open: boolean; onClose: () => void; memberId: number | null; memberName?: string }) {
  const toast = useToast()
  const { register, handleSubmit, reset, setError, control, formState } = useForm<NotifyValues>({ resolver: zodResolver(notifySchema), defaultValues: { message: '' } })
  const message = useWatch({ control, name: 'message' }) ?? ''

  useEffect(() => {
    if (open) reset({ message: '' })
  }, [open, reset])

  const submit = handleSubmit(async (values) => {
    if (!memberId) return
    try {
      const result = await notificationsApi.send({ message: values.message.trim(), member_ids: [memberId] })
      invalidate(`member:${memberId}`, 'notifications')
      if (result.delivered) toast.success('Message sent', { description: 'It appears in the member’s app.' })
      else toast.warning('Not delivered', { description: `${memberName ?? 'This member'} doesn’t use the member app yet. Create an app login first.` })
      onClose()
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.fromError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Send in-app message"
      description={memberName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="notify-form" icon={Send} loading={formState.isSubmitting}>
            Send
          </Button>
        </>
      }
    >
      <form id="notify-form" onSubmit={submit} className="space-y-3" noValidate>
        <TextareaField
          label="Message"
          required
          rows={4}
          maxLength={MAX}
          placeholder="e.g. Your membership ends on Friday — renew at the desk or in the app."
          hint={`${message.length}/${MAX}`}
          error={formState.errors.message?.message}
          {...register('message')}
          data-autofocus
        />
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
          Delivered inside the member app only.
        </p>
      </form>
    </Dialog>
  )
}
