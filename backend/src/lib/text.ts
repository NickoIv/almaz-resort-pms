/**
 * Text hygiene for free-text fields that came from a form.
 *
 * This is NOT escaping - values are stored exactly as typed and escaped at the
 * point of use (HTML-escaped for the notification digest; React escapes on
 * render). Storing pre-escaped text is what produces the classic "&amp;amp;"
 * corruption, so it is deliberately avoided. Cyrillic and any other Unicode
 * round-trips unchanged.
 */

const MAX_NAME_LENGTH = 120

/**
 * Replaces C0/C1 control characters with a space. Done by code point rather
 * than a regex so no literal control character ever appears in this source.
 * They become spaces rather than nothing, so a name split by a stray newline
 * stays two words instead of being glued together.
 */
function stripControlChars(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f)
    out += isControl ? ' ' : char
  }
  return out
}

/** Trims, collapses runs of whitespace and strips control characters. */
export function cleanName(value: unknown, maxLength = MAX_NAME_LENGTH): string {
  return stripControlChars(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** Same treatment for an optional field: empty becomes null rather than an empty string. */
export function cleanOptional(value: unknown, maxLength = MAX_NAME_LENGTH): string | null {
  if (value === null || value === undefined) return null
  const cleaned = cleanName(value, maxLength)
  return cleaned === '' ? null : cleaned
}
