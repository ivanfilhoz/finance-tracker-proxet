import { budgetNow } from "#/server/budget-clock.server";
import { eq } from "drizzle-orm";
import { db, schema } from "#/db";
import { listBudgets } from "#/server/budgets.server";
import { sendEmail, type EmailMessage } from "#/server/email";
import { formatMoney } from "#/lib/money";
import { m } from "#/paraglide/messages";
import { getLogger } from "#/server/logger";

export async function evaluateBudgetAlerts(
  userId: string,
  now = budgetNow(userId),
  send: (message: EmailMessage) => Promise<void> = sendEmail,
) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.email || !user.email_verified_at) return;
  const { items, period } = await listBudgets(userId, now);
  for (const budget of items.filter((item) => item.exceeded)) {
    const id = crypto.randomUUID();
    // Claim before sending. Ambiguous failures keep the claim: no duplicate attempts.
    const claimed = await db
      .insert(schema.budget_notifications)
      .values({ id, user_id: userId, budget_id: budget.id, period_start: period.start })
      .onConflictDoNothing()
      .returning({ id: schema.budget_notifications.id });
    if (!claimed.length) continue;
    try {
      await send({
        to: user.email,
        subject: m.budget_email_subject({ category: budget.categoryName }),
        text: m.budget_email_body({
          category: budget.categoryName,
          month: period.start.slice(0, 7),
          spent: formatMoney(budget.spent, budget.currency),
          limit: formatMoney(budget.limit_minor, budget.currency),
        }),
      });
      await db
        .update(schema.budget_notifications)
        .set({ state: "sent", sent_at: now })
        .where(eq(schema.budget_notifications.id, id));
    } catch {
      await db
        .update(schema.budget_notifications)
        .set({ state: "failed" })
        .where(eq(schema.budget_notifications.id, id));
      getLogger().warn({ budgetId: budget.id }, "budget email attempt failed; claim retained");
    }
  }
}

/** Await after committed financial mutations, including partial streamed imports. */
export async function reconcileBudgets(userId: string) {
  try {
    await evaluateBudgetAlerts(userId);
  } catch {
    getLogger().warn({ userId }, "budget reconciliation failed");
  }
}
