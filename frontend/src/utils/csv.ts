// RFC 4180 CSV — written for reports and backups, read back when restoring a backup.

export type Cell = string | number | boolean | null | undefined

const FORMULA_START = /^[=+\-@\t\r]/

function quote(value: Cell, neutralize: boolean): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'string' ? value : String(value)
  // Reports are opened in spreadsheets: stop text that looks like a formula from running.
  // (Backups keep exact values so they restore unchanged.)
  if (neutralize && typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(header: string[], rows: Cell[][], options: { neutralize?: boolean } = {}): string {
  const neutralize = options.neutralize ?? false
  const lines = [header.map((h) => quote(h, false)).join(',')]
  for (const row of rows) lines.push(row.map((cell) => quote(cell, neutralize)).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** CSV text as a file; the byte-order mark makes Excel read UTF-8 names correctly. */
export function csvBlob(text: string): Blob {
  return new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' })
}

/** Parse CSV into rows of fields (handles quotes, embedded newlines, CRLF and a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (quoted) throw new Error('The file ends inside a quoted value.')
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Rows as objects keyed by the header row. */
export function parseCsvObjects(text: string): { header: string[]; rows: Record<string, string>[] } {
  const [header = [], ...body] = parseCsv(text)
  const rows = body
    .filter((cells) => cells.length > 1 || cells[0] !== '')
    .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])))
  return { header, rows }
}
