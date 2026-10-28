import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { budgetInput, budgetUpdate } from "#/lib/budgets";
import { requireUserId } from "#/server/session";
import { listBudgets, createBudget, updateBudget, deleteBudget } from "#/server/budgets.server";
import { reconcileBudgets } from "#/server/budget-alerts.server";

export const getBudgets = createServerFn({ method: "GET" }).handler(async () =>
  listBudgets(await requireUserId()),
);
export const addBudget = createServerFn({ method: "POST" })
  .inputValidator(budgetInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const result = await createBudget(userId, data);
    if ("success" in result) await reconcileBudgets(userId);
    return result;
  });
export const editBudget = createServerFn({ method: "POST" })
  .inputValidator(budgetUpdate)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const result = await updateBudget(userId, data);
    if ("success" in result) await reconcileBudgets(userId);
    return result;
  });
export const removeBudget = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => deleteBudget(await requireUserId(), data.id));
