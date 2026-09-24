import { LineChart } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { MetricTiles } from '@/components/training/MetricTiles'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useDocumentTitle } from '@/hooks/useUtilities'
import { portalApi } from '@/services/endpoints'
import type { Metric } from '@/types'
import { formatDate } from '@/utils/format'
import { METRIC_META } from '@/utils/metrics'

const ProgressChart = lazy(() => import('@/components/charts/ProgressChart'))
const COLUMNS: Metric[] = ['weight', 'body_fat', 'waist', 'chest', 'arm', 'thigh']

export default function PortalProgressPage() {
  useDocumentTitle('Progress')
  const progress = useApi('portal:progress', () => portalApi.progress())
  const data = progress.data
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">My progress</h1>
      {progress.loading && !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : progress.error ? (
        <ErrorState error={progress.error} onRetry={progress.reload} />
      ) : !data?.history.length ? (
        <Card>
          <EmptyState icon={LineChart} title="No measurements yet" description="Your trainer records your weight and measurements — they'll show up here." />
        </Card>
      ) : (
        <>
          <MetricTiles latest={data.latest} change={data.change} bmi={data.bmi} />
          <Card>
            <CardHeader title="Trend" />
            <div className="px-3 pb-4 sm:px-5">
              <Suspense fallback={<Skeleton className="h-60 rounded-xl" />}>
                <ProgressChart history={data.history} />
              </Suspense>
            </div>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="divide-y divide-line">
              {data.history.map((h) => (
                <li key={h.id} className="px-5 py-3">
                  <p className="text-sm font-semibold text-ink">{formatDate(h.date)}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {COLUMNS.filter((m) => h[m] !== null && h[m] !== undefined)
                      .map((m) => `${METRIC_META[m].label} ${h[m]} ${METRIC_META[m].unit}`)
                      .join(' · ') || 'Other measurements'}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
