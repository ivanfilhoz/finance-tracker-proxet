import { db, schema } from "#/db";
import { reconcileBudgets } from "#/server/budget-alerts.server";
import { getLogger } from "#/server/logger";

/** Catch date-driven threshold changes and interrupted reconciliation without
 * requiring another user edit. Persistent notification claims prevent repeats. */
export async function runBudgetSweep() {
  const owners = await db.selectDistinct({ userId: schema.budgets.user_id }).from(schema.budgets);
  for (const { userId } of owners) await reconcileBudgets(userId);
}

let started = false;
export function ensureBudgetLoop() {
  if (started || process.env.TEST_MODE === "1") return;
  started = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runBudgetSweep();
    } catch {
      getLogger().warn("budget sweep failed");
    } finally {
      running = false;
    }
  };
  // Startup catch-up is scheduled independently of the request that arms it.
  setTimeout(() => {
    void tick();
  }, 0).unref();
  setInterval(() => {
    void tick();
  }, 60_000).unref();
}
