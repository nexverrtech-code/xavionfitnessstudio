import { ArchiveRestore, Clock3, Database, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { BackupPanel } from '@/components/backup/BackupPanel'
import { RestorePanel } from '@/components/backup/RestorePanel'
import { StoragePanel, type BackupPrefill } from '@/components/backup/StoragePanel'
import { TimeTravelPanel } from '@/components/backup/TimeTravelPanel'
import { PageHeader, Tabs } from '@/components/ui/Navigation'
import { useDocumentTitle } from '@/hooks/useUtilities'

type Tab = 'storage' | 'backup' | 'restore' | 'time-travel'

/** Admin only: storage monitoring, backups (download → verify → archive), restore and Time Travel. */
export default function DataBackupPage() {
  useDocumentTitle('Data & Backup')
  const [params, setParams] = useSearchParams()
  const tab = (['storage', 'backup', 'restore', 'time-travel'].includes(params.get('tab') ?? '') ? params.get('tab') : 'storage') as Tab
  const [prefill, setPrefill] = useState<BackupPrefill | null>(null)
  const go = (value: Tab) => setParams(value === 'storage' ? {} : { tab: value }, { replace: true })

  return (
    <div>
      <PageHeader title="Data & Backup" description="Keep the database small and safe: monitor storage, download backups, archive old records and restore" />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={go}
        items={[
          { value: 'storage', label: 'Storage', icon: Database },
          { value: 'backup', label: 'Backup & archive', icon: ShieldCheck },
          { value: 'restore', label: 'Restore', icon: ArchiveRestore },
          { value: 'time-travel', label: 'Time Travel', icon: Clock3 },
        ]}
      />
      <div role="tabpanel">
        {tab === 'storage' && (
          <StoragePanel
            onStartBackup={(value) => {
              setPrefill(value)
              go('backup')
            }}
          />
        )}
        {tab === 'backup' && <BackupPanel prefill={prefill} />}
        {tab === 'restore' && <RestorePanel />}
        {tab === 'time-travel' && <TimeTravelPanel />}
      </div>
    </div>
  )
}
