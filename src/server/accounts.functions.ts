import { reconcileBudgets } from "#/server/budget-alerts.server";
import { createServerFn } from "@tanstack/react-start";
import { eq, and, asc, count, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "#/db";
import { checkAccountLimit } from "#/server/billing.server";
import { requireUserId } from "#/server/session";


const currencyRegex = /^[A-Z]{3}$/;

const createAccountSchema = z.object({
  name: z.string().min(1).max(128),
  bank: z.string().max(128).optional().or(z.literal("")),
  currency: z
    .string()
    .regex(currencyRegex, "Currency must be a 3-letter ISO code (e.g. PLN, USD)")
    .default("PLN"),
});

const updateAccountSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(128),
  bank: z.string().max(128).optional().or(z.literal("")),
  currency: z
    .string()
    .regex(currencyRegex, "Currency must be a 3-letter ISO code (e.g. PLN, USD)")
    .default("PLN"),
});

const deleteAccountSchema = z.object({
  id: z.string(),
});

export const getAccounts = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    const accounts = await db
      .select({
        id: schema.accounts.id,
        name: schema.accounts.name,
        bank: schema.accounts.bank,
        currency: schema.accounts.currency,
        created_at: schema.accounts.created_at,
        transactionCount: sql<number>`(
          SELECT COUNT(*) FROM ${schema.transactions} WHERE ${schema.transactions.account_id} = ${schema.accounts.id}
        )`.mapWith(Number),
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.user_id, userId))
      .orderBy(asc(schema.accounts.name));
    return accounts;
  },
);

export const createAccount = createServerFn({ method: "POST" })
  .inputValidator(createAccountSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    const limit = await checkAccountLimit(userId);
    if (!limit.allowed) {
      return { error: limit.error, code: limit.code, limit: limit.limit };
    }

    const id = crypto.randomUUID();
    await db.insert(schema.accounts).values({
      id,
      user_id: userId,
      name: data.name,
      bank: data.bank || null,
      currency: data.currency || "PLN",
    });

    return {
      id,
      name: data.name,
      bank: data.bank || null,
      currency: data.currency || "PLN",
    };
  });

export const updateAccount = createServerFn({ method: "POST" })
  .inputValidator(updateAccountSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    try {
      await db
        .update(schema.accounts)
        .set({
          name: data.name,
          bank: data.bank || null,
          currency: data.currency || "PLN",
        })
        .where(
          and(
            eq(schema.accounts.id, data.id),
            eq(schema.accounts.user_id, userId),
          ),
        );

      return { success: true };
    } finally {
      await reconcileBudgets(userId);
    }
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .inputValidator(deleteAccountSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    // Check for transactions in this account (scoped to user)
    const transactionCount = await db
      .select({ count: count() })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.account_id, data.id),
          eq(schema.transactions.user_id, userId),
        ),
      );
    const countVal = transactionCount[0]?.count ?? 0;

    if (countVal > 0) {
      return {
        error: `Cannot delete account with ${countVal} transaction(s). All transactions will be deleted.`,
        transactionCount: countVal,
      };
    }

    await db
      .delete(schema.accounts)
      .where(
        and(
          eq(schema.accounts.id, data.id),
          eq(schema.accounts.user_id, userId),
        ),
      );
    return { success: true };
  });
