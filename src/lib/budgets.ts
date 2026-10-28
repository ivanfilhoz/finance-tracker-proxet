import { z } from "zod";

export const BUDGETS_QUERY_KEY = ["budgets"] as const;
export const budgetInput = z.object({
  categoryId: z.string().min(1),
  currency: z.string().refine((value) => Intl.supportedValuesOf("currency").includes(value)),
  limitMinor: z.number().int().positive().max(2_147_483_647),
});
export const budgetUpdate = budgetInput
  .omit({ categoryId: true })
  .extend({ id: z.string().min(1) });
export type BudgetInput = z.infer<typeof budgetInput>;
export type BudgetUpdate = z.infer<typeof budgetUpdate>;
export type BudgetError = "invalid" | "missing" | "duplicate" | "limit";

export function budgetPeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10),
  };
}
