// Backups are built in the browser: the Worker streams rows page by page (JSON), and the
// browser writes CSV files + metadata.json into a ZIP the admin downloads. The same code reads
// a saved ZIP back to verify it (checksums, row counts) and to restore it.
import type { BackupManifest, BackupTable } from '@/types'
import { toCsv, parseCsvObjects, type Cell } from '@/utils/csv'
import { createZip, readZip, sha256Hex, type ZipFile } from '@/utils/zip'
import { backupsApi } from './endpoints'

export const METADATA_FILE = 'metadata.json'
const FORMAT = 1
const PLANS = 'workout_plans'
const EXERCISES = 'workout_exercises'

export interface BackupMetadata {
  app: 'SmartGym'
  format: number
  backup_id: number
  file_name: string
  gym_name: string
  created_at: string
  created_by: string | null
  period: { from: string | null; to: string | null }
  datasets: string[]
  record_count: number
  tables: { table: string; dataset: string; file: string; rows: number; columns: string[] }[]
  files: { file: string; bytes: number; sha256: string }[]
}

export interface BuiltBackup {
  blob: Blob
  fileName: string
  checksum: string
  counts: Record<string, number>
}

type Row = Record<string, unknown>

/** workout_history.csv holds plans and their exercises: one row per exercise, plan columns
 *  repeated. Column names both tables share (id, notes) get a plan_ / exercise_ prefix. */
function workoutLayout(plan: string[], exercise: string[]) {
  const shared = new Set(plan.filter((c) => exercise.includes(c)))
  const exerciseColumns = exercise.filter((c) => c !== 'workout_plan_id')
  return {
    planHeader: plan.map((c) => (shared.has(c) ? `plan_${c}` : c)),
    exerciseColumns,
    exerciseHeader: exerciseColumns.map((c) => (shared.has(c) ? `exercise_${c}` : c)),
  }
}

async function fetchTable(backupId: number, table: BackupTable, pageSize: number, onRows: (count: number) => void): Promise<Row[]> {
  const rows: Row[] = []
  let after = 0
  for (;;) {
    const page = await backupsApi.exportPage(backupId, table.table, after)
    rows.push(...page)
    onRows(page.length)
    if (page.length < pageSize) return rows
    after = Number(page[page.length - 1].id)
  }
}

const cell = (value: unknown): Cell => (value === undefined ? null : (value as Cell))

export async function buildBackup(
  manifest: BackupManifest,
  options: { gymName: string; pageSize: number; onProgress?: (done: number, total: number) => void },
): Promise<BuiltBackup> {
  const { backup, tables } = manifest
  const total = Math.max(1, tables.reduce((sum, t) => sum + t.rows, 0))
  let done = 0
  const report = (count: number) => {
    done += count
    options.onProgress?.(Math.min(done, total), total)
  }
  const data = new Map<string, Row[]>()
  for (const table of tables) data.set(table.table, await fetchTable(backup.id, table, options.pageSize, report))

  const encoder = new TextEncoder()
  const files: ZipFile[] = []
  const written = new Set<string>()
  for (const table of tables) {
    if (written.has(table.file)) continue
    written.add(table.file)
    let csv: string
    if (table.table === PLANS || table.table === EXERCISES) {
      const planTable = tables.find((t) => t.table === PLANS)!
      const exerciseTable = tables.find((t) => t.table === EXERCISES)!
      const layout = workoutLayout(planTable.columns, exerciseTable.columns)
      const byPlan = new Map<number, Row[]>()
      for (const exercise of data.get(EXERCISES) ?? []) {
        const key = Number(exercise.workout_plan_id)
        byPlan.set(key, [...(byPlan.get(key) ?? []), exercise])
      }
      const rows: Cell[][] = []
      const blankExercise = layout.exerciseColumns.map(() => null)
      for (const plan of data.get(PLANS) ?? []) {
        const planCells = planTable.columns.map((c) => cell(plan[c]))
        const exercises = byPlan.get(Number(plan.id)) ?? []
        byPlan.delete(Number(plan.id))
        if (!exercises.length) rows.push([...planCells, ...blankExercise])
        for (const exercise of exercises) rows.push([...planCells, ...layout.exerciseColumns.map((c) => cell(exercise[c]))])
      }
      // Exercises whose plan falls outside the period keep just the plan id.
      for (const [planId, exercises] of byPlan) {
        const planCells = planTable.columns.map((c) => (c === 'id' ? planId : null))
        for (const exercise of exercises) rows.push([...planCells, ...layout.exerciseColumns.map((c) => cell(exercise[c]))])
      }
      csv = toCsv([...layout.planHeader, ...layout.exerciseHeader], rows)
    } else {
      csv = toCsv(table.columns, (data.get(table.table) ?? []).map((row) => table.columns.map((c) => cell(row[c]))))
    }
    files.push({ name: table.file, data: encoder.encode(csv) })
  }

  const counts = Object.fromEntries(tables.map((t) => [t.table, data.get(t.table)?.length ?? 0]))
  const metadata: BackupMetadata = {
    app: 'SmartGym',
    format: FORMAT,
    backup_id: backup.id,
    file_name: backup.file_name ?? `SmartGym_Backup_${backup.id}.zip`,
    gym_name: options.gymName,
    created_at: backup.created_at,
    created_by: backup.created_by_name,
    period: { from: backup.period_from, to: backup.period_to },
    datasets: backup.datasets,
    record_count: Object.values(counts).reduce((a, b) => a + b, 0),
    tables: tables.map((t) => ({ table: t.table, dataset: t.dataset, file: t.file, rows: counts[t.table], columns: t.columns })),
    files: await Promise.all(files.map(async (f) => ({ file: f.name, bytes: f.data.length, sha256: await sha256Hex(f.data) }))),
  }
  const zip = createZip([{ name: METADATA_FILE, data: encoder.encode(JSON.stringify(metadata, null, 2)) }, ...files])
  return {
    blob: new Blob([zip as BlobPart], { type: 'application/zip' }),
    fileName: metadata.file_name,
    checksum: await sha256Hex(zip),
    counts,
  }
}

// -- reading a saved backup ------------------------------------------------------------------------
export interface ParsedTable {
  table: string
  dataset: string
  file: string
  rows: Record<string, string>[]
}

export interface ParsedBackup {
  metadata: BackupMetadata
  tables: ParsedTable[]
  counts: Record<string, number>
  checksum: string
  fileName: string
}

export class BackupFileError extends Error {}

/** Open a SmartGym backup ZIP, check every file against metadata.json, and read the rows. */
export async function readBackup(file: File): Promise<ParsedBackup> {
  if (!/\.zip$/i.test(file.name)) throw new BackupFileError('Choose the SmartGym backup file (.zip).')
  const buffer = await file.arrayBuffer()
  let entries: Map<string, Uint8Array>
  try {
    entries = await readZip(buffer)
  } catch (error) {
    throw new BackupFileError((error as Error).message)
  }
  const metaBytes = entries.get(METADATA_FILE)
  if (!metaBytes) throw new BackupFileError("This ZIP isn't a SmartGym backup (metadata.json is missing).")
  let metadata: BackupMetadata
  try {
    metadata = JSON.parse(new TextDecoder().decode(metaBytes)) as BackupMetadata
  } catch {
    throw new BackupFileError('metadata.json is damaged.')
  }
  if (metadata.app !== 'SmartGym' || !Array.isArray(metadata.tables) || !Array.isArray(metadata.files)) {
    throw new BackupFileError("This ZIP isn't a SmartGym backup.")
  }
  if (metadata.format > FORMAT) throw new BackupFileError('This backup was made by a newer version of SmartGym.')

  const decoder = new TextDecoder()
  const texts = new Map<string, string>()
  for (const entry of metadata.files) {
    const bytes = entries.get(entry.file)
    if (!bytes) throw new BackupFileError(`${entry.file} is missing from the backup.`)
    if ((await sha256Hex(bytes)) !== entry.sha256) throw new BackupFileError(`${entry.file} was changed or damaged after download.`)
    texts.set(entry.file, decoder.decode(bytes))
  }

  const tables: ParsedTable[] = []
  const counts: Record<string, number> = {}
  const planMeta = metadata.tables.find((t) => t.table === PLANS)
  const exerciseMeta = metadata.tables.find((t) => t.table === EXERCISES)
  let workout: { plans: Record<string, string>[]; exercises: Record<string, string>[] } | null = null
  for (const meta of metadata.tables) {
    const text = texts.get(meta.file)
    if (text === undefined) throw new BackupFileError(`${meta.file} is missing from the backup.`)
    let rows: Record<string, string>[]
    if ((meta.table === PLANS || meta.table === EXERCISES) && planMeta && exerciseMeta) {
      workout ??= splitWorkouts(text, planMeta.columns, exerciseMeta.columns)
      rows = meta.table === PLANS ? workout.plans : workout.exercises
    } else {
      const parsed = parseCsvObjects(text)
      const missing = meta.columns.filter((c) => !parsed.header.includes(c))
      if (missing.length) throw new BackupFileError(`${meta.file} is missing columns: ${missing.join(', ')}.`)
      rows = parsed.rows
    }
    counts[meta.table] = rows.length
    tables.push({ table: meta.table, dataset: meta.dataset, file: meta.file, rows })
  }
  return { metadata, tables, counts, checksum: await sha256Hex(buffer), fileName: file.name }
}

function splitWorkouts(text: string, planColumns: string[], exerciseColumns: string[]) {
  const layout = workoutLayout(planColumns, exerciseColumns)
  const { header, rows } = parseCsvObjects(text)
  const expected = [...layout.planHeader, ...layout.exerciseHeader]
  const missing = expected.filter((c) => !header.includes(c))
  if (missing.length) throw new BackupFileError(`workout_history.csv is missing columns: ${missing.join(', ')}.`)
  const plans = new Map<string, Record<string, string>>()
  const exercises: Record<string, string>[] = []
  const planIdKey = layout.planHeader[planColumns.indexOf('id')]
  for (const row of rows) {
    const planId = row[planIdKey]
    const plan = Object.fromEntries(planColumns.map((c, i) => [c, row[layout.planHeader[i]] ?? '']))
    // Rows that carry only the plan id belong to a plan outside the backup's period.
    const hasPlan = planColumns.some((c) => c !== 'id' && plan[c] !== '')
    if (hasPlan && planId && !plans.has(planId)) plans.set(planId, plan)
    const exercise = Object.fromEntries(layout.exerciseColumns.map((c, i) => [c, row[layout.exerciseHeader[i]] ?? '']))
    if (exercise.id) exercises.push({ ...exercise, workout_plan_id: planId })
  }
  return { plans: [...plans.values()], exercises }
}
