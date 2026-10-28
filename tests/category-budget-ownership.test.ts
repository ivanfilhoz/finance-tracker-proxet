// @vitest-environment node
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";

import { deleteCategoryForUser } from "../src/server/categories.server";

describe("category deletion and budget ownership", () => {
  it("rejects a foreign category before cascading budgets and notifications", async () => {
    const owner = crypto.randomUUID(),
      attacker = crypto.randomUUID(),
      cat = crypto.randomUUID(),
      budget = crypto.randomUUID();
    await db
      .insert(schema.users)
      .values([owner, attacker].map((id) => ({ id, username: id, password_hash: "fixture" })));
    await db.insert(schema.categories).values({ id: cat, user_id: owner, name: "Private" });
    await db
      .insert(schema.budgets)
      .values({ id: budget, user_id: owner, category_id: cat, currency: "PLN", limit_minor: 100 });
    await db.insert(schema.budget_notifications).values({
      id: crypto.randomUUID(),
      user_id: owner,
      budget_id: budget,
      period_start: "2026-10-01",
    });
    expect(await deleteCategoryForUser(attacker, { id: cat })).toEqual({
      error: "Category not found",
    });
    expect(
      await db.select().from(schema.budgets).where(eq(schema.budgets.id, budget)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.budget_notifications)
        .where(eq(schema.budget_notifications.budget_id, budget)),
    ).toHaveLength(1);
    expect(await deleteCategoryForUser(owner, { id: cat })).toEqual({ success: true });
    expect(
      await db.select().from(schema.budgets).where(eq(schema.budgets.id, budget)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.budget_notifications)
        .where(eq(schema.budget_notifications.budget_id, budget)),
    ).toHaveLength(0);
  });
});
