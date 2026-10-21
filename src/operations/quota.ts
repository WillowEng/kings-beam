import type { RequestBudget } from "../providers/adapter";
import { Operations } from "./store";
import { instant } from "../core/time";
export type Purpose = "normal" | "recovery" | "diagnostics" | "emergency";
const CAPS = { recovery: 75, diagnostics: 20, emergency: 15 };
/** Conservative disjoint partitions: production 260 + TEST 80 + reserves 110 = 450. No automatic billing reset. */
export function operationBudget(ops: Operations, at: string, purpose: Purpose): RequestBudget {
  const normal = ops.store.budget(at);
  let period: string | null = null;
  return {
    async reserve(provider, cost, timestamp) {
      if (provider === "balldontlie" || purpose === "normal" || ops.store.scope === "test") return normal.reserve(provider, cost, timestamp);
      instant(at);
      if (timestamp !== at || !Number.isSafeInteger(cost) || cost < 1 || !(await ops.store.settings()).value.enabled[provider] || !await ops.ready(provider, at)) return false;
      // Share the explicit account period from the production partition; never invent calendar renewal.
      const configured = await ops.stmt("SELECT period_start,period_end FROM quota_counters WHERE provider='odds_api' AND period_start<=? AND period_end>?", at, at).first<{ period_start: string; period_end: string }>();
      if (!configured) return false;
      await ops.stmt("INSERT OR IGNORE INTO quota_reserves(purpose,period_start,period_end,cap) VALUES(?,?,?,?)", purpose, configured.period_start, configured.period_end, CAPS[purpose]).run();
      const write = await ops.stmt("UPDATE quota_reserves SET used=used+? WHERE purpose=? AND period_start=? AND used+?<=cap", cost, purpose, configured.period_start, cost).run();
      if (write.meta.changes === 1) period = configured.period_start;
      return write.meta.changes === 1;
    },
    async chargeExtra(provider, cost) {
      if (provider === "balldontlie" || purpose === "normal" || ops.store.scope === "test") return normal.chargeExtra(provider, cost);
      if (!period || !Number.isSafeInteger(cost) || cost < 1) throw new Error("invalid_charge");
      await ops.stmt("UPDATE quota_reserves SET used=used+? WHERE purpose=? AND period_start=?", cost, purpose, period).run();
    },
  };
}

/** Production emergency reserve is available only for a sound current-day provisional victory. */
export function withEmergency(base: RequestBudget, ops: Operations, at: string, permitted: boolean): RequestBudget {
  const emergency = operationBudget(ops, at, "emergency");
  let selected = base;
  return {
    async reserve(provider, cost, timestamp) {
      if (await base.reserve(provider, cost, timestamp)) { selected = base; return true; }
      if (provider === "odds_api" && ops.store.scope === "production" && permitted && await emergency.reserve(provider, cost, timestamp)) { selected = emergency; return true; }
      return false;
    },
    chargeExtra: (provider, cost) => selected.chargeExtra(provider, cost),
  };
}
