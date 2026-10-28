import { budgetNow } from "#/server/budget-clock.server";
import { and, eq, gte, lt, sql, asc } from "drizzle-orm";
import { db, schema } from "#/db";
import {
  budgetInput,
  budgetUpdate,
  budgetPeriod,
  type BudgetInput,
  type BudgetUpdate,
  type BudgetError,
} from "#/lib/budgets";
import { getEntitlements } from "#/server/billing.server";

type Result = { success: true; id: string } | { error: BudgetError };

export async function listBudgets(userId: string, now = budgetNow(userId)) {
  const period = budgetPeriod(now);
  const rows = await db
    .select()
    .from(schema.budgets)
    .where(eq(schema.budgets.user_id, userId))
    .orderBy(asc(schema.budgets.created_at));
  const categories = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.user_id, userId));
  // Aggregate once by category/currency; do not load every transaction into JS.
  const totals = rows.length
    ? await db
        .select({
          categoryId: schema.transactions.category_id,
          currency: schema.accounts.currency,
          spent: sql<number>`sum(-${schema.transactions.amount_minor}::bigint)`.mapWith(Number),
        })
        .from(schema.transactions)
        .innerJoin(
          schema.accounts,
          and(
            eq(schema.accounts.id, schema.transactions.account_id),
            eq(schema.accounts.user_id, userId),
          ),
        )
        .where(
          and(
            eq(schema.transactions.user_id, userId),
            lt(schema.transactions.amount_minor, 0),
            gte(schema.transactions.date, period.start),
            lt(schema.transactions.date, period.end),
          ),
        )
        .groupBy(schema.transactions.category_id, schema.accounts.currency)
    : [];
  const children = new Map<string, string[]>();
  for (const category of categories) {
    if (category.parent_id)
      children.set(category.parent_id, [...(children.get(category.parent_id) ?? []), category.id]);
  }
  const items = rows.map((budget) => {
    const included = new Set<string>();
    const pending = [budget.category_id];
    while (pending.length) {
      const id = pending.pop()!;
      if (included.has(id)) continue;
      included.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    const spent = totals.reduce(
      (sum, row) =>
        sum +
        (row.categoryId && included.has(row.categoryId) && row.currency === budget.currency
          ? row.spent
          : 0),
      0,
    );
    return {
      ...budget,
      categoryName: categories.find((c) => c.id === budget.category_id)?.name ?? "",
      spent,
      remaining: budget.limit_minor - spent,
      exceeded: spent > budget.limit_minor,
    };
  });
  const accounts = await db
    .select({ currency: schema.accounts.currency })
    .from(schema.accounts)
    .where(eq(schema.accounts.user_id, userId));
  const [user] = await db
    .select({ email: schema.users.email, verified: schema.users.email_verified_at })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return {
    items,
    categories,
    currencies: [...new Set(accounts.map((a) => a.currency).filter((c): c is string => !!c))],
    period,
    maxBudgets: (await getEntitlements(userId)).maxBudgets,
    emailReady: !!(user?.email && user.verified),
  };
}

export async function createBudget(userId: string, input: BudgetInput): Promise<Result> {
  const parsed = budgetInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  // All creates for this user take the same row lock before checking the cap.
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for("update");
    if (!user) return { error: "missing" };
    const [category] = await tx
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(and(eq(schema.categories.id, data.categoryId), eq(schema.categories.user_id, userId)))
      .for("share");
    if (!category) return { error: "missing" };
    const existing = await tx
      .select({ category: schema.budgets.category_id })
      .from(schema.budgets)
      .where(eq(schema.budgets.user_id, userId));
    if (existing.some((b) => b.category === data.categoryId)) return { error: "duplicate" };
    const { maxBudgets } = await getEntitlements(userId, tx);
    if (maxBudgets !== null && existing.length >= maxBudgets) return { error: "limit" };
    const id = crypto.randomUUID();
    await tx.insert(schema.budgets).values({
      id,
      user_id: userId,
      category_id: data.categoryId,
      currency: data.currency,
      limit_minor: data.limitMinor,
    });
    return { success: true, id };
  });
}

export async function updateBudget(userId: string, input: BudgetUpdate): Promise<Result> {
  const parsed = budgetUpdate.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  const rows = await db
    .update(schema.budgets)
    .set({ limit_minor: data.limitMinor, currency: data.currency, updated_at: new Date() })
    .where(and(eq(schema.budgets.id, data.id), eq(schema.budgets.user_id, userId)))
    .returning({ id: schema.budgets.id });
  return rows.length ? { success: true, id: data.id } : { error: "missing" };
}

export async function deleteBudget(userId: string, id: string): Promise<Result> {
  const rows = await db
    .delete(schema.budgets)
    .where(and(eq(schema.budgets.id, id), eq(schema.budgets.user_id, userId)))
    .returning({ id: schema.budgets.id });
  return rows.length ? { success: true, id } : { error: "missing" };
}
