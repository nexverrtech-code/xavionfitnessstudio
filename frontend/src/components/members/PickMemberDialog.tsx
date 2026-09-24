import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import type { MemberListItem } from '@/types'
import { MemberPicker } from './MemberPicker'

export function PickMemberDialog({ open, onClose, title, actionLabel, onPick }: { open: boolean; onClose: () => void; title: string; actionLabel: string; onPick: (member: MemberListItem) => void }) {
  const [member, setMember] = useState<MemberListItem | null>(null)
  useEffect(() => {
    if (open) setMember(null)
  }, [open])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!member}
            onClick={() => {
              if (!member) return
              onClose()
              onPick(member)
            }}
          >
            {actionLabel}
          </Button>
        </>
      }
    >
      <MemberPicker value={member} onChange={setMember} autoFocus />
    </Dialog>
  )
}
