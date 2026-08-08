import { SQL_NOW } from './time'

/** Appends a row to audit_log. Never throws — auditing must not break a request. */
export async function writeAudit(
  db: D1Database,
  staffUserId: number | null,
  action: string,
  entity: string,
  entityId: number | null
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (staff_user_id, action, entity, entity_id, created_at)
         VALUES (?, ?, ?, ?, ${SQL_NOW})`
      )
      .bind(staffUserId, action, entity, entityId)
      .run()
  } catch (error) {
    console.error('audit_log write failed', error)
  }
}