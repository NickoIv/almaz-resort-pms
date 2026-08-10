import {
  renderTelegramHtml,
  renderWhatsApp,
  type Digest,
  type NotifyChannel,
} from './notifications'
import { sendTelegramMessage, TelegramNotConfigured } from './telegram'
import { isWhatsAppConfigured, sendWhatsAppMessage, WhatsAppNotConfigured } from './whatsapp'
import type { Bindings } from '../types'

/**
 * External delivery is off — because the channel turned out to be unavailable,
 * not because it is unwanted.
 *
 * The hotel did ask for the WhatsApp digest back on 2026-08-10, and it was
 * switched on. It then could not be supplied: Green API's free tier caps an
 * instance at three chats and allows one instance per account, the account's
 * one instance belongs to another project, and the hotel will not take a paid
 * subscription. So the switch went back off the same day rather than leave
 * production advertising a channel that answers "не настроен" forever.
 *
 * What the hotel actually wanted — every member of staff notified personally —
 * is now served by Web Push, which needs no third party's quota. See
 * lib/webpush.ts and lib/push.ts.
 *
 * Nothing here was deleted. This remains the single switch for the whole
 * feature: the cron's send, the "Отправить тест" button, the channel chips and
 * the credential warnings all follow it, the last two because the settings
 * response carries it as `external_delivery` and the page reads the server
 * rather than hardcoding a decision. Both positions are covered by tests, so
 * if a Green API instance ever exists, turning it on is one edit.
 *
 * Typed `boolean` on purpose: as a literal type the guards elsewhere narrow to
 * dead code and the unused path stops being type-checked.
 */
export const EXTERNAL_DELIVERY_ENABLED: boolean = false

export type DeliveryResult = {
  channel: 'whatsapp' | 'telegram'
  sent: boolean
  error?: string
}

export function whatsappConfigOf(env: Bindings) {
  return {
    instanceId: env.GREEN_API_INSTANCE_ID,
    token: env.GREEN_API_TOKEN,
    chatId: env.GREEN_API_CHAT_ID,
    apiUrl: env.GREEN_API_URL,
  }
}

export function channelStatus(env: Bindings) {
  return {
    external_delivery: EXTERNAL_DELIVERY_ENABLED,
    whatsapp_configured: isWhatsAppConfigured(whatsappConfigOf(env)),
    telegram_configured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  }
}

function wanted(channel: NotifyChannel): ('whatsapp' | 'telegram')[] {
  if (channel === 'both') return ['whatsapp', 'telegram']
  return [channel]
}

/**
 * Sends a digest to every channel the admin selected.
 *
 * Each channel is attempted independently: with 'both', a Telegram outage must
 * not stop the WhatsApp message. The caller decides what a partial failure means.
 */
export async function deliverDigest(
  env: Bindings,
  channel: NotifyChannel,
  digest: Digest
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = []

  for (const target of wanted(channel)) {
    try {
      if (target === 'whatsapp') {
        await sendWhatsAppMessage(whatsappConfigOf(env), renderWhatsApp(digest))
      } else {
        await sendTelegramMessage(
          { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID },
          renderTelegramHtml(digest)
        )
      }
      results.push({ channel: target, sent: true })
    } catch (error) {
      const notConfigured =
        error instanceof WhatsAppNotConfigured || error instanceof TelegramNotConfigured
      results.push({
        channel: target,
        sent: false,
        error: notConfigured
          ? (error as Error).message
          : error instanceof Error
            ? error.message
            : 'Не удалось отправить сообщение',
      })
    }
  }

  return results
}