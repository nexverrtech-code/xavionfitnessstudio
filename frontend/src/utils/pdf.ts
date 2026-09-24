// A minimal, dependency-free PDF writer for receipts and reports, built in the browser.
// Uses the built-in Helvetica fonts (WinAnsiEncoding), so no font files are embedded and the
// output stays tiny. Coordinates are top-left based (y grows downward).

const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]
const SPECIAL_WIDTHS: Record<number, number> = { 0x95: 350, 0x96: 556, 0x97: 1000, 0x85: 1000 }
const REPLACEMENTS: [string, string][] = [
  ['₹', 'Rs. '],
  ['−', '-'],
  ['\u00a0', ' '],
  ['\u202f', ' '],
  ['→', '->'],
  ['✓', 'v'],
]
// Windows-1252 bytes 0x80–0x9F that differ from Latin-1.
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b,
  'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99,
  'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

export const A4 = { width: 595.28, height: 841.89 }

export type Color = [number, number, number]

export function hexColor(value: string): Color {
  const hex = value.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Color
}

function encode(text: string): number[] {
  let value = text
  for (const [from, to] of REPLACEMENTS) value = value.split(from).join(to)
  const bytes: number[] = []
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 63
    if (code >= 32 && code <= 126) bytes.push(code)
    else if (code >= 0xa0 && code <= 0xff) bytes.push(code)
    else bytes.push(CP1252[ch] ?? 63) // "?"
  }
  return bytes
}

export function textWidth(text: string, size: number, bold = false): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA
  let total = 0
  for (const byte of encode(text)) total += byte >= 32 && byte <= 126 ? table[byte - 32] : (SPECIAL_WIDTHS[byte] ?? 556)
  return (total * size) / 1000
}

export function fitText(text: string, size: number, maxWidth: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxWidth) return text
  let value = text
  while (value && textWidth(`${value}...`, size, bold) > maxWidth) value = value.slice(0, -1)
  return value ? `${value.trimEnd()}...` : ''
}

/** Split text into lines that fit maxWidth (word wrap). */
export function wrapText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (textWidth(next, size, bold) <= maxWidth || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.map((l) => fitText(l, size, maxWidth, bold))
}

function escape(bytes: number[]): string {
  let out = ''
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte)
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`
    else if (byte >= 32 && byte <= 126) out += ch
    else out += `\\${byte.toString(8).padStart(3, '0')}`
  }
  return out
}

const num = (value: number) => (Math.round(value * 100) / 100).toString()

interface TextOptions {
  size?: number
  bold?: boolean
  color?: Color
  align?: 'left' | 'right' | 'center'
  maxWidth?: number
}

export class PdfDocument {
  readonly width: number
  readonly height: number
  private pages: string[][] = []
  private current = 0
  private title: string
  private author: string

  constructor(options: { landscape?: boolean; title?: string; author?: string } = {}) {
    this.width = options.landscape ? A4.height : A4.width
    this.height = options.landscape ? A4.width : A4.height
    this.title = options.title ?? 'Document'
    this.author = options.author ?? ''
    this.addPage()
  }

  get pageCount(): number {
    return this.pages.length
  }

  addPage(): void {
    this.pages.push([])
    this.current = this.pages.length - 1
  }

  /** Draw on an earlier page (used for "Page 1 of 3" footers once the count is known). */
  onPage(index: number, draw: () => void): void {
    const previous = this.current
    this.current = index
    try {
      draw()
    } finally {
      this.current = previous
    }
  }

  private get ops(): string[] {
    return this.pages[this.current]
  }

  text(x: number, y: number, value: string, options: TextOptions = {}): void {
    const { size = 10, bold = false, color = [0.09, 0.1, 0.12], align = 'left', maxWidth } = options
    const content = maxWidth !== undefined ? fitText(value, size, maxWidth, bold) : value
    if (!content) return
    const width = textWidth(content, size, bold)
    const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x
    const baseline = this.height - y - size * 0.8
    this.ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(color[0])} ${num(color[1])} ${num(color[2])} rg ` +
        `${num(left)} ${num(baseline)} Td (${escape(encode(content))}) Tj ET`,
    )
  }

  rect(x: number, y: number, w: number, h: number, options: { fill?: Color; stroke?: Color; lineWidth?: number; radius?: number } = {}): void {
    const { fill, stroke, lineWidth = 0.6, radius = 0 } = options
    const ops: string[] = []
    if (fill) ops.push(`${num(fill[0])} ${num(fill[1])} ${num(fill[2])} rg`)
    if (stroke) ops.push(`${num(stroke[0])} ${num(stroke[1])} ${num(stroke[2])} RG ${num(lineWidth)} w`)
    const bottom = this.height - y - h
    if (radius <= 0) {
      ops.push(`${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re`)
    } else {
      const r = Math.min(radius, w / 2, h / 2)
      const k = r * 0.5523
      const [x0, y0, x1, y1] = [x, bottom, x + w, bottom + h]
      ops.push(
        `${num(x0 + r)} ${num(y0)} m ${num(x1 - r)} ${num(y0)} l ` +
          `${num(x1 - r + k)} ${num(y0)} ${num(x1)} ${num(y0 + r - k)} ${num(x1)} ${num(y0 + r)} c ` +
          `${num(x1)} ${num(y1 - r)} l ` +
          `${num(x1)} ${num(y1 - r + k)} ${num(x1 - r + k)} ${num(y1)} ${num(x1 - r)} ${num(y1)} c ` +
          `${num(x0 + r)} ${num(y1)} l ` +
          `${num(x0 + r - k)} ${num(y1)} ${num(x0)} ${num(y1 - r + k)} ${num(x0)} ${num(y1 - r)} c ` +
          `${num(x0)} ${num(y0 + r)} l ` +
          `${num(x0)} ${num(y0 + r - k)} ${num(x0 + r - k)} ${num(y0)} ${num(x0 + r)} ${num(y0)} c h`,
      )
    }
    ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S')
    this.ops.push(ops.join(' '))
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { color?: Color; width?: number } = {}): void {
    const { color = [0.85, 0.87, 0.9], width = 0.6 } = options
    this.ops.push(
      `${num(color[0])} ${num(color[1])} ${num(color[2])} RG ${num(width)} w ` +
        `${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`,
    )
  }

  async output(): Promise<Blob> {
    const encoder = new TextEncoder()
    const objects: Uint8Array[] = []
    const add = (body: Uint8Array | string) => {
      objects.push(typeof body === 'string' ? latin1(body) : body)
      return objects.length
    }
    const catalogId = add('')
    const pagesId = add('')
    const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    const pageIds: number[] = []
    for (const ops of this.pages) {
      const raw = latin1(ops.join('\n'))
      const compressed = await deflate(raw)
      const stream = compressed ?? raw
      const header = `<< /Length ${stream.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`
      const contentId = add(concat([latin1(header), stream, latin1('\nendstream')]))
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
            `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`,
        ),
      )
    }
    objects[catalogId - 1] = latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
    objects[pagesId - 1] = latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
    const created = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const author = this.author ? ` /Author (${escape(encode(this.author))}) /Creator (${escape(encode(this.author))})` : ''
    const infoId = add(`<< /Title (${escape(encode(this.title))})${author} /CreationDate (D:${created}Z) >>`)

    const parts: Uint8Array[] = [latin1('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')]
    let length = parts[0].length
    const offsets: number[] = []
    objects.forEach((body, index) => {
      offsets.push(length)
      const chunk = concat([latin1(`${index + 1} 0 obj\n`), body, latin1('\nendobj\n')])
      parts.push(chunk)
      length += chunk.length
    })
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('')
    parts.push(
      encoder.encode(
        `${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${length}\n%%EOF\n`,
      ),
    )
    return new Blob(parts as BlobPart[], { type: 'application/pdf' })
  }
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** zlib-compress a content stream when the browser can (PDF FlateDecode); otherwise store it. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}
