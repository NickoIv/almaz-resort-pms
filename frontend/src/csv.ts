/** CSV export for the current view. */

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Builds a CSV and hands it to the browser as a download.
 *
 * Excel on a Russian locale expects a semicolon delimiter, and without a UTF-8
 * BOM it renders Cyrillic as mojibake — both are handled here so the file opens
 * correctly by double-click.
 */
export function downloadCsv(filename: string, rows: (string | number | null)[][]): void {
  const body = rows.map((row) => row.map(escapeCell).join(';')).join('\r\n')
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8;' })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}