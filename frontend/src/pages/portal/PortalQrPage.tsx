import { Sun, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { QRCode } from '@/components/qr/QRCode'
import { Card } from '@/components/ui/Card'
import { ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useConfig } from '@/contexts/ConfigContext'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle, useOnline } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import { KEYS, readJSON, writeJSON } from '@/utils/storage'

interface CachedQr {
  member_code: string
  name: string
  payload: string
}

/** The member's entry pass. Cached on the device so it still works with poor reception at the door. */
export default function PortalQrPage() {
  useDocumentTitle('My QR')
  const config = useConfig()
  const online = useOnline()
  const [cached] = useState<CachedQr | null>(() => readJSON<CachedQr>(KEYS.memberQr))
  const qr = useApi('portal:qr', () => portalApi.qr())
  useEffect(() => {
    if (qr.data) writeJSON(KEYS.memberQr, { member_code: qr.data.member_code, name: qr.data.name, payload: qr.data.payload })
  }, [qr.data])
  const data = qr.data ?? cached

  if (!data && qr.error) return <ErrorState error={qr.error} onRetry={qr.reload} />
  return (
    <div className="flex flex-col items-center">
      <h1 className="sr-only">My QR code</h1>
      <Card className="w-full max-w-sm overflow-hidden">
        <div className="bg-hero px-6 pb-16 pt-6 text-center text-white">
          <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/60">{config.gym_name}</p>
          <p className="mt-2 text-xl font-bold">{data?.name ?? '…'}</p>
          <p className="tabular text-sm text-volt">{data?.member_code}</p>
        </div>
        <div className="-mt-12 flex justify-center px-6">
          <div className="rounded-3xl bg-white p-4 shadow-pop">
            {data ? <QRCode value={data.payload} size={236} label={`Attendance QR code for ${data.name}`} /> : <Skeleton className="size-[236px] rounded-2xl" />}
          </div>
        </div>
        <div className="space-y-2 p-6 text-center">
          <p className="text-sm font-semibold text-ink">Show this at the front desk to check in</p>
          <p className="flex items-center justify-center gap-1.5 text-[13px] text-muted">
            <Sun className="size-4" aria-hidden /> Turn up your screen brightness for faster scans
          </p>
          {!online && (
            <p className="flex items-center justify-center gap-1.5 text-[13px] text-warning-700 dark:text-warning-400">
              <WifiOff className="size-4" aria-hidden /> Offline — showing your saved QR
            </p>
          )}
        </div>
      </Card>
      <p className="mt-4 max-w-sm text-center text-[12px] text-faint">Your QR is personal. If you think someone else has it, ask the front desk to issue a new one.</p>
    </div>
  )
}
