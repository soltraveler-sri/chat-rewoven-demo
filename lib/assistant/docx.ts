const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

interface ZipEntry {
  name: string
  data: Uint8Array
}

interface ParsedTable {
  headers: string[]
  rows: string[][]
  nextIndex: number
}

const encoder = new TextEncoder()

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index++) {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[index] = value >>> 0
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\\\|/g, "|")
    .trim()
}

function paragraphXml(
  text: string,
  options: { heading?: 1 | 2; bullet?: boolean; italic?: boolean } = {}
): string {
  const size = options.heading === 1 ? "32" : options.heading === 2 ? "26" : "22"
  const spacingAfter = options.heading ? "180" : "120"
  const runProps = [
    options.heading ? "<w:b/>" : "",
    options.italic ? "<w:i/>" : "",
    `<w:sz w:val="${size}"/>`,
  ].join("")
  const paragraphProps = [
    `<w:spacing w:after="${spacingAfter}" w:line="276" w:lineRule="auto"/>`,
    options.bullet ? '<w:ind w:left="360" w:hanging="180"/>' : "",
  ].join("")
  const prefix = options.bullet ? "• " : ""

  return [
    "<w:p>",
    `<w:pPr>${paragraphProps}</w:pPr>`,
    `<w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${xmlEscape(
      `${prefix}${stripMarkdownInline(text)}`
    )}</w:t></w:r>`,
    "</w:p>",
  ].join("")
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripMarkdownInline(cell))
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function parseTable(lines: string[], startIndex: number): ParsedTable | null {
  if (!lines[startIndex]?.trim().startsWith("|")) return null
  if (!isTableSeparator(lines[startIndex + 1] || "")) return null

  const headers = parseTableCells(lines[startIndex])
  const rows: string[][] = []
  let nextIndex = startIndex + 2

  while (lines[nextIndex]?.trim().startsWith("|")) {
    rows.push(parseTableCells(lines[nextIndex]))
    nextIndex++
  }

  return { headers, rows, nextIndex }
}

function tableCellXml(value: string, isHeader: boolean): string {
  const runProps = isHeader ? "<w:b/><w:sz w:val=\"20\"/>" : "<w:sz w:val=\"20\"/>"

  return [
    "<w:tc>",
    '<w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>',
    `<w:p><w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${xmlEscape(
      stripMarkdownInline(value)
    )}</w:t></w:r></w:p>`,
    "</w:tc>",
  ].join("")
}

function tableXml(headers: string[], rows: string[][]): string {
  const border =
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D9DEE3"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D9DEE3"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9DEE3"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D9DEE3"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9DEE3"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9DEE3"/></w:tblBorders>'
  const headerRow = `<w:tr>${headers.map((cell) => tableCellXml(cell, true)).join("")}</w:tr>`
  const bodyRows = rows
    .map((row) => {
      const cells = headers.map((_, index) => row[index] || "")
      return `<w:tr>${cells.map((cell) => tableCellXml(cell, false)).join("")}</w:tr>`
    })
    .join("")

  return [
    "<w:tbl>",
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/>${border}</w:tblPr>`,
    headerRow,
    bodyRows,
    "</w:tbl>",
    paragraphXml(""),
  ].join("")
}

function markdownToDocumentXml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const body: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const line = raw.trim()
    if (!line) continue

    const table = parseTable(lines, index)
    if (table) {
      body.push(tableXml(table.headers, table.rows))
      index = table.nextIndex - 1
      continue
    }

    if (line.startsWith("# ")) {
      body.push(paragraphXml(line.slice(2), { heading: 1 }))
    } else if (line.startsWith("## ")) {
      body.push(paragraphXml(line.slice(3), { heading: 2 }))
    } else if (line.startsWith("- ")) {
      body.push(paragraphXml(line.slice(2), { bullet: true }))
    } else {
      body.push(paragraphXml(line, { italic: /^_.*_$/.test(line) }))
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    body.join(""),
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
    "</w:body>",
    "</w:document>",
  ].join("")
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function zip(entries: ZipEntry[]): Blob {
  const now = dosDateTime(new Date())
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0)
    writeUint16(localView, 8, 0)
    writeUint16(localView, 10, now.time)
    writeUint16(localView, 12, now.date)
    writeUint32(localView, 14, crc)
    writeUint32(localView, 18, size)
    writeUint32(localView, 22, size)
    writeUint16(localView, 26, nameBytes.length)
    writeUint16(localView, 28, 0)
    localHeader.set(nameBytes, 30)
    localParts.push(localHeader, entry.data)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, 0x02014b50)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0)
    writeUint16(centralView, 10, 0)
    writeUint16(centralView, 12, now.time)
    writeUint16(centralView, 14, now.date)
    writeUint32(centralView, 16, crc)
    writeUint32(centralView, 20, size)
    writeUint32(centralView, 24, size)
    writeUint16(centralView, 28, nameBytes.length)
    writeUint16(centralView, 30, 0)
    writeUint16(centralView, 32, 0)
    writeUint16(centralView, 34, 0)
    writeUint16(centralView, 36, 0)
    writeUint32(centralView, 38, 0)
    writeUint32(centralView, 42, offset)
    centralHeader.set(nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + entry.data.length
  }

  const centralDirectory = concat(centralParts)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, entries.length)
  writeUint16(endView, 10, entries.length)
  writeUint32(endView, 12, centralDirectory.length)
  writeUint32(endView, 16, offset)
  writeUint16(endView, 20, 0)

  return new Blob([toArrayBuffer(concat([...localParts, centralDirectory, end]))], {
    type: DOCX_MIME,
  })
}

function textEntry(name: string, content: string): ZipEntry {
  return { name, data: encoder.encode(content) }
}

export function docxFilenameFor(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") + ".docx"
}

export function makeDocxBlobFromMarkdown(markdown: string, title: string): Blob {
  const createdAt = new Date().toISOString()
  const documentXml = markdownToDocumentXml(markdown)

  return zip([
    textEntry(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'
    ),
    textEntry(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
    ),
    textEntry("word/document.xml", documentXml),
    textEntry(
      "docProps/core.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(
        title
      )}</dc:title><dc:creator>Assistant demo</dc:creator><cp:lastModifiedBy>Assistant demo</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`
    ),
    textEntry(
      "docProps/app.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Assistant demo</Application></Properties>'
    ),
  ])
}
