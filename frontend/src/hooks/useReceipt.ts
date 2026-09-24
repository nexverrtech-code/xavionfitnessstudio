import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { downloadReceipt } from '@/services/documents'
import { paymentsApi, portalApi } from '@/services/endpoints'

/** Fetch a receipt (JSON) and save it as a PDF built in the browser. */
export function useReceipt(scope: 'staff' | 'member' = 'staff') {
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  const download = async (payment: { id: number }) => {
    setBusy(payment.id)
    try {
      await downloadReceipt(await (scope === 'member' ? portalApi.receipt(payment.id) : paymentsApi.receipt(payment.id)))
    } catch (error) {
      toast.fromError(error, "We couldn't create the receipt. Please try again.")
    } finally {
      setBusy(null)
    }
  }
  return { busy, download }
}
