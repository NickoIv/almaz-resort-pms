import type { Bindings } from '../types'

/**
 * Where backups are kept.
 *
 * R2 is the natural home, but it has to be switched on in the Cloudflare
 * dashboard first, and this project was chosen for services that work on the
 * free plan with no card. Workers KV needs no such step, so both are supported
 * and whichever is bound wins — R2 first if present.
 *
 * KV's 25 MiB per-value ceiling is far above this dataset; the daily job logs
 * loudly if a snapshot ever approaches it.
 */
export type StoredBackup = {
  key: string
  uploaded: string | null
  size: number | null
}

export type BackupStore = {
  kind: 'r2' | 'kv'
  put(key: string, body: string): Promise<void>
  get(key: string): Promise<string | null>
  list(prefix: string): Promise<StoredBackup[]>
  delete(key: string): Promise<void>
}

/** KV values do not carry metadata for free, so size/date ride along. */
type KvMeta = { uploaded: string; size: number }

export function backupStore(env: Bindings): BackupStore | null {
  if (env.BACKUPS_R2) {
    const bucket = env.BACKUPS_R2
    return {
      kind: 'r2',
      async put(key, body) {
        await bucket.put(key, body, {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
        })
      },
      async get(key) {
        const object = await bucket.get(key)
        return object ? await object.text() : null
      },
      async list(prefix) {
        const listed = await bucket.list({ prefix })
        return listed.objects.map((object) => ({
          key: object.key,
          uploaded: object.uploaded?.toISOString() ?? null,
          size: object.size,
        }))
      },
      async delete(key) {
        await bucket.delete(key)
      },
    }
  }

  if (env.BACKUPS) {
    const kv = env.BACKUPS
    return {
      kind: 'kv',
      async put(key, body) {
        const metadata: KvMeta = { uploaded: new Date().toISOString(), size: body.length }
        await kv.put(key, body, { metadata })
      },
      async get(key) {
        return kv.get(key, 'text')
      },
      async list(prefix) {
        const listed = await kv.list<KvMeta>({ prefix })
        return listed.keys.map((entry) => ({
          key: entry.name,
          uploaded: entry.metadata?.uploaded ?? null,
          size: entry.metadata?.size ?? null,
        }))
      },
      async delete(key) {
        await kv.delete(key)
      },
    }
  }

  return null
}

export const DAILY_PREFIX = 'daily/'

/** How many daily snapshots to keep. */
export const RETENTION = 7

/**
 * Deletes the oldest daily snapshots beyond the retention window.
 * Keys are timestamped and sort chronologically, so lexical order is
 * chronological order — no need to read metadata to decide what is oldest.
 */
export async function pruneDaily(store: BackupStore, keep = RETENTION): Promise<string[]> {
  const existing = await store.list(DAILY_PREFIX)
  const sorted = existing.map((item) => item.key).sort()
  const doomed = sorted.slice(0, Math.max(0, sorted.length - keep))

  for (const key of doomed) await store.delete(key)
  return doomed
}
