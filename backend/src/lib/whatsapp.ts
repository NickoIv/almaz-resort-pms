/**
 * WhatsApp delivery through Green API (green-api.com).
 *
 * Green API fronts a real WhatsApp account, so there is no template approval
 * and no card required — the same reason the rest of this stack was chosen.
 * Credentials live in Wrangler secrets, never in the database or the client.
 */

export type WhatsAppConfig = {
  instanceId: string | undefined
  token: string | undefined
  chatId: string | undefined
  /** Green API hands out per-instance hosts; falls back to the shared one. */
  apiUrl?: string
}

export class WhatsAppNotConfigured extends Error {
  constructor() {
    super(
      'WhatsApp не настроен: задайте секреты GREEN_API_INSTANCE_ID, GREEN_API_TOKEN и GREEN_API_CHAT_ID'
    )
    this.name = 'WhatsAppNotConfigured'
  }
}

export function isWhatsAppConfigured(config: WhatsAppConfig): boolean {
  return Boolean(config.instanceId && config.token && config.chatId)
}

/**
 * Green API wants a chat id like `77011112233@c.us` for a person or
 * `1234567890-1600000000@g.us` for a group. Accept a bare phone number too and
 * normalise it, since that is what people paste.
 */
export function normalizeChatId(raw: string): string {
  const value = raw.trim()
  if (value.includes('@')) return value

  const digits = value.replace(/\D/g, '')
  return `${digits}@c.us`
}

export async function sendWhatsAppMessage(
  config: WhatsAppConfig,
  text: string
): Promise<{ ok: true; id: string | null }> {
  if (!isWhatsAppConfigured(config)) throw new WhatsAppNotConfigured()

  const base = (config.apiUrl ?? 'https://api.green-api.com').replace(/\/$/, '')
  const url = `${base}/waInstance${config.instanceId}/sendMessage/${config.token}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: normalizeChatId(config.chatId!),
        message: text,
      }),
    })
  } catch {
    // A transport failure surfaces as an opaque runtime error, which is
    // useless to an admin looking at the Settings screen. The URL embeds the
    // token, so the host is reported without it.
    const host = base.replace(/^https?:\/\//, '')
    throw new Error(`Не удалось связаться с Green API (${host}). Проверьте GREEN_API_URL и сеть.`)
  }

  const raw = await response.text().catch(() => '')

  if (!response.ok) {
    // The token is part of the URL, so the URL must never reach a log or an
    // API response.
    throw new Error(`Green API вернул ${response.status}: ${raw.slice(0, 300)}`)
  }

  let id: string | null = null
  try {
    id = (JSON.parse(raw) as { idMessage?: string }).idMessage ?? null
  } catch {
    // A 2xx without parseable JSON still counts as sent.
  }

  return { ok: true, id }
}