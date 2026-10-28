// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  listBudgets,
} from "../src/server/budgets.server";
import { evaluateBudgetAlerts } from "../src/server/budget-alerts.server";
import { collectUserExport, hardDeleteUser } from "../src/server/compliance.server";
import { runBudgetSweep } from "../src/server/budget-sweep.server";
import { setBudgetTestClock } from "../src/server/budget-clock.server";
import { budgetPeriod } from "../src/lib/budgets";

const now = new Date("2026-10-15T12:00:00Z");
let user: string, other: string, parent: string, child: string, grandchild: string, account: string;
const id = () => crypto.randomUUID();
async function category(owner: string, parentId?: string) {
  const key = id();
  await db
    .insert(schema.categories)
    .values({ id: key, user_id: owner, name: key, parent_id: parentId });
  return key;
}
async function expense(amount = -10001, date = "2026-10-15", cat = grandchild, acct = account) {
  await db.insert(schema.transactions).values({
    id: id(),
    user_id: user,
    account_id: acct,
    category_id: cat,
    date,
    amount_minor: amount,
  });
}
async function budget(cat = parent, limit = 10000) {
  const result = await createBudget(user, { categoryId: cat, limitMinor: limit, currency: "PLN" });
  if (!("id" in result)) throw new Error(JSON.stringify(result));
  return result.id;
}
beforeEach(async () => {
  user = id();
  other = id();
  account = id();
  await db.insert(schema.users).values(
    [user, other].map((key) => ({
      id: key,
      username: key,
      email: `${key}@example.com`,
      email_verified_at: now,
      password_hash: "fixture",
    })),
  );
  parent = await category(user);
  child = await category(user, parent);
  grandchild = await category(user, child);
  await db
    .insert(schema.accounts)
    .values({ id: account, user_id: user, name: "Main", currency: "PLN" });
});

describe("monthly budgets", () => {
  it("B6/B7: background sweep catches future spending once the month rolls over", async () => {
    const key = await budget();
    await expense(-10001, "2026-11-01");
    setBudgetTestClock(user, new Date("2026-10-31T23:59:59Z"));
    await runBudgetSweep();
    expect(
      await db
        .select()
        .from(schema.budget_notifications)
        .where(eq(schema.budget_notifications.budget_id, key)),
    ).toHaveLength(0);
    setBudgetTestClock(user, new Date("2026-11-01T00:00:01Z"));
    await runBudgetSweep();
    await runBudgetSweep();
    const claims = await db
      .select()
      .from(schema.budget_notifications)
      .where(eq(schema.budget_notifications.budget_id, key));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ period_start: "2026-11-01", state: "sent" });
  });
  it("B2: persists edit/delete and rejects duplicate, invalid and foreign categories", async () => {
    const key = await budget();
    expect(
      await createBudget(user, { categoryId: parent, currency: "PLN", limitMinor: 10 }),
    ).toEqual({ error: "duplicate" });
    for (const value of [0, -1, 1.2, 2147483648])
      expect(await updateBudget(user, { id: key, currency: "PLN", limitMinor: value })).toEqual({
        error: "invalid",
      });
    expect(
      await createBudget(user, {
        categoryId: await category(other),
        currency: "PLN",
        limitMinor: 1,
      }),
    ).toEqual({ error: "missing" });
    expect(await updateBudget(other, { id: key, currency: "PLN", limitMinor: 20 })).toEqual({
      error: "missing",
    });
    expect(await deleteBudget(other, key)).toEqual({ error: "missing" });
    expect((await listBudgets(other, now)).items).toEqual([]);
    await updateBudget(user, { id: key, currency: "PLN", limitMinor: 20000 });
    expect((await listBudgets(user, now)).items[0].limit_minor).toBe(20000);
    await deleteBudget(user, key);
    expect((await listBudgets(user, now)).items).toEqual([]);
  });
  it("B3-B6: integer expenses, all descendants, currency and monthly window; refunds do not net spending", async () => {
    await budget();
    await expense(-6000, "2026-10-01", parent);
    await expense(-3000, "2026-10-15", child);
    await expense(-1000);
    await expense(5000);
    await expense(0);
    await expense(-99999, "2026-09-30");
    await expense(-99999, "2026-11-01");
    const usd = id();
    await db
      .insert(schema.accounts)
      .values({ id: usd, user_id: user, name: "USD", currency: "USD" });
    await expense(-99999, "2026-10-15", child, usd);
    let item = (await listBudgets(user, now)).items[0];
    expect(item).toMatchObject({ spent: 10000, remaining: 0, exceeded: false });
    await expense(-1);
    item = (await listBudgets(user, now)).items[0];
    expect(item).toMatchObject({ spent: 10001, remaining: -1, exceeded: true });
    expect((await listBudgets(user, new Date("2026-12-01Z"))).items[0]).toMatchObject({
      limit_minor: 10000,
      spent: 0,
    });
  });
  it("B4: cycles terminate and each descendant counts once", async () => {
    await budget();
    await expense();
    await db
      .update(schema.categories)
      .set({ parent_id: grandchild })
      .where(eq(schema.categories.id, parent));
    expect((await listBudgets(user, now)).items[0].spent).toBe(10001);
  });
  it("B6: calendar boundaries include leap February and year rollover", () => {
    expect(budgetPeriod(new Date("2024-02-29T23:59:59Z"))).toEqual({
      start: "2024-02-01",
      end: "2024-03-01",
    });
    expect(budgetPeriod(new Date("2026-12-31T23:59:59Z"))).toEqual({
      start: "2026-12-01",
      end: "2027-01-01",
    });
  });
  it("B8: concurrent creation cannot exceed Free cap; Pro and downgrade retain data", async () => {
    const cats = await Promise.all(Array.from({ length: 6 }, () => category(user)));
    const results = await Promise.all(
      cats.map((categoryId) =>
        createBudget(user, { categoryId, currency: "PLN", limitMinor: 100 }),
      ),
    );
    expect(results.filter((r) => "success" in r)).toHaveLength(3);
    expect(results.filter((r) => "error" in r && r.error === "limit")).toHaveLength(3);
    await db.insert(schema.subscriptions).values({ user_id: user, plan: "pro", status: "active" });
    const fourth = await budget(parent);
    await db
      .update(schema.subscriptions)
      .set({ plan: "free" })
      .where(eq(schema.subscriptions.user_id, user));
    expect((await listBudgets(user, now)).items).toHaveLength(4);
    expect(
      await updateBudget(user, { id: fourth, currency: "PLN", limitMinor: 500 }),
    ).toMatchObject({ success: true });
    expect(
      await createBudget(user, { categoryId: child, currency: "PLN", limitMinor: 100 }),
    ).toEqual({ error: "limit" });
  });
  it("B7: concurrent evaluation, re-crossing and reloads send once; next month sends again", async () => {
    await budget();
    await expense();
    const send = vi.fn(async () => {});
    await Promise.all([
      evaluateBudgetAlerts(user, now, send),
      evaluateBudgetAlerts(user, now, send),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    await db.delete(schema.transactions).where(eq(schema.transactions.user_id, user));
    await evaluateBudgetAlerts(user, now, send);
    await expense();
    await evaluateBudgetAlerts(user, now, send);
    await listBudgets(user, now);
    expect(send).toHaveBeenCalledTimes(1);
    await expense(-10001, "2026-11-01");
    await evaluateBudgetAlerts(user, new Date("2026-11-01Z"), send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toBeDefined();
  });
  it("B7: no send at equality, missing/unverified recipients, or past-month excess", async () => {
    await budget();
    await expense(-10000);
    const send = vi.fn(async () => {});
    await evaluateBudgetAlerts(user, now, send);
    expect(send).not.toHaveBeenCalled();
    await expense(-1);
    await db.update(schema.users).set({ email_verified_at: null }).where(eq(schema.users.id, user));
    await evaluateBudgetAlerts(user, now, send);
    expect(send).not.toHaveBeenCalled();
    await db
      .update(schema.users)
      .set({ email_verified_at: now, email: null })
      .where(eq(schema.users.id, user));
    await evaluateBudgetAlerts(user, now, send);
    expect(send).not.toHaveBeenCalled();
    await db
      .update(schema.users)
      .set({ email: `${user}@example.com` })
      .where(eq(schema.users.id, user));
    await evaluateBudgetAlerts(user, new Date("2026-11-15Z"), send);
    expect(send).not.toHaveBeenCalled();
    await evaluateBudgetAlerts(user, now, send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("B7: failed delivery keeps its claim and does not retry or lose the transaction", async () => {
    await budget();
    await expense();
    const send = vi.fn(async () => {
      throw new Error("timeout");
    });
    await evaluateBudgetAlerts(user, now, send);
    await evaluateBudgetAlerts(user, now, send);
    expect(send).toHaveBeenCalledTimes(1);
    const notices = await db
      .select()
      .from(schema.budget_notifications)
      .where(eq(schema.budget_notifications.user_id, user));
    expect(notices[0].state).toBe("failed");
    expect((await listBudgets(user, now)).items[0].spent).toBe(10001);
  });
  it("B10: exports scoped data, category deletion cascades, hard deletion removes all new data", async () => {
    const key = await budget();
    await expense();
    await evaluateBudgetAlerts(user, now, async () => {});
    expect((await collectUserExport(user)).budgets[0].id).toBe(key);
    expect((await collectUserExport(user)).budgetNotifications).toHaveLength(1);
    expect((await collectUserExport(other)).budgets).toHaveLength(0);
    await db.delete(schema.categories).where(eq(schema.categories.id, parent));
    expect((await collectUserExport(user)).budgetNotifications).toHaveLength(0);
    await budget(child);
    await evaluateBudgetAlerts(user, now, async () => {});
    await hardDeleteUser(user);
    expect(
      await db.select().from(schema.budgets).where(eq(schema.budgets.user_id, user)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.budget_notifications)
        .where(eq(schema.budget_notifications.user_id, user)),
    ).toHaveLength(0);
    expect((await collectUserExport(other)).user.id).toBe(other);
  });
});
