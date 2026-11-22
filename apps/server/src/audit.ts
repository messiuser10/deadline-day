import type { Db } from './db/client';
import { auditLog } from './db/schema';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  target?: string | null;
  gameId?: string | null;
  details?: Record<string, unknown> | null;
}

/** Every admin and host action is written here (section 11). */
export function audit(db: Pick<Db, 'insert'>, entry: AuditEntry): void {
  db.insert(auditLog)
    .values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      target: entry.target ?? null,
      gameId: entry.gameId ?? null,
      details: entry.details ?? null,
    })
    .run();
}
