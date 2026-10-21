import { Operations, later } from "../operations/store";
import type { Monitor } from "./health";
/** At-least-once durable delivery: a crash after sending can repeat a signal with the same delivery ID. */
export async function deliverOutbox(ops: Operations, monitor: Monitor, at: string): Promise<{ delivered: number; failed: number }> {
  const started = Date.now();
  const token = await ops.lease("outbox", at, 120_000);
  if (!token) return { delivered: 0, failed: 0 };
  const report = { delivered: 0, failed: 0 };
  try {
    const rows = await ops.stmt("SELECT id,transition,attempts FROM notification_outbox WHERE delivered_at IS NULL AND (next_at IS NULL OR next_at<=?) ORDER BY created_at,id LIMIT 10", at).all<{ id: string; transition: "open" | "recovery"; attempts: number }>();
    for (const row of rows.results) {
      let sent = false;
      try { sent = await monitor.send(row.transition, ops.store.scope, row.id); } catch { /* Fixed retry outcome; never record raw delivery errors. */ }
      await ops.assertLease("outbox", token, later(at, Date.now() - started));
      await ops.stmt("UPDATE notification_outbox SET attempts=attempts+1,delivered_at=?,next_at=? WHERE id=? AND delivered_at IS NULL", sent ? at : null, sent ? null : later(at, Math.min(6 * 3_600_000, 60_000 * 2 ** Math.min(row.attempts, 8))), row.id).run();
      if (sent) report.delivered++; else report.failed++;
    }
    return report;
  } finally { await ops.release("outbox", token); }
}
