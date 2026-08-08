/** Minimal Telegram Bot API client — just enough to push a message. */

export type TelegramConfig = {
  botToken: string | undefined
  chatId: string | undefined
}

export class TelegramNotConfigured extends Error {
  constructor() {
    super('Telegram не настроен: задайте секреты TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID')
    this.name = 'TelegramNotConfigured'
  }
}

/**
 * Sends an HTML message to the configured chat.
 * Credentials come from Wrangler secrets and are never stored in the database.
 */
export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string
): Promise<{ ok: true } | never> {
  if (!config.botToken || !config.chatId) throw new TelegramNotConfigured()

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // The bot token must never reach a log or an API response.
    throw new Error(`Telegram API вернул ${response.status}: ${detail.slice(0, 300)}`)
  }

  return { ok: true }
}