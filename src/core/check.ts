import { Store } from "../data/db";
import { TEAMS } from "./teams";
import type { ClassificationContext } from "./eligibility";
import type { AdapterResult, Transport } from "../providers/adapter";
import { result } from "../providers/adapter";
import { fetchBalldontlie } from "../providers/balldontlie";
import { fetchOddsApi } from "../providers/oddsApi";

/** Internal orchestration only: not exported as an HTTP or scheduled handler. */
export async function checkSources(store: Store, options: {
  transport: Transport; keys: { balldontlie: string; odds_api: string };
  at: string; context: ClassificationContext; startDate: string; endDate: string;
}): Promise<AdapterResult[]> {
  const settings = await store.settings();
  const snapshot = await store.snapshot(options.at);
  const results: AdapterResult[] = [];
  for (const provider of settings.value.priority) {
    if (!settings.value.enabled[provider]) {
      results.push({ ...result(provider), errors: ["disabled"] });
      continue;
    }
    const common = { transport: options.transport, budget: store.budget(options.at), observedAt: options.at };
    let output: AdapterResult;
    try {
      output = provider === "balldontlie"
        ? await fetchBalldontlie({ ...common, apiKey: options.keys.balldontlie, context: options.context,
          dates: { start: options.startDate, end: options.endDate }, teamId: TEAMS.find(t => t.id === snapshot.team)!.bdlId })
        : await fetchOddsApi({ ...common, apiKey: options.keys.odds_api });
    } catch {
      // A bad source/config never exposes exception details or skips the other source.
      output = { ...result(provider), errors: ["invalid_response"] };
    }
    await store.applyResult(output, options.at);
    results.push(output);
  }
  // A partial/page-limited query never certifies schedule completeness here.
  return results;
}
