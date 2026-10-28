import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Wallet, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { getBudgets, addBudget, editBudget, removeBudget } from "#/server/budgets.functions";
import { BUDGETS_QUERY_KEY, budgetPeriod, budgetInput, type BudgetError } from "#/lib/budgets";
import { formatMoney, formatMinor, parseAmountToMinor } from "#/lib/money";
import { m } from "#/paraglide/messages";
import { cn } from "#/lib/utils";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Select, SelectItem } from "#/components/ui/select";
import { Label } from "#/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "#/components/ui/dialog";

export const Route = createFileRoute("/_authed/budgets")({ component: BudgetsPage });
type Budget = Awaited<ReturnType<typeof getBudgets>>["items"][number];

function errorMessage(code: BudgetError | "generic") {
  switch (code) {
    case "invalid":
      return m.budget_error_invalid();
    case "missing":
      return m.budget_error_missing();
    case "duplicate":
      return m.budget_error_duplicate();
    case "limit":
      return m.budget_error_limit();
    default:
      return m.budget_error_generic();
  }
}

function BudgetsPage() {
  const userId = Route.useRouteContext().user!.userId;
  const queryClient = useQueryClient();
  const get = useServerFn(getBudgets);
  const add = useServerFn(addBudget);
  const edit = useServerFn(editBudget);
  const remove = useServerFn(removeBudget);
  const [month, setMonth] = useState(() => budgetPeriod().start);
  useEffect(() => {
    const timer = setInterval(() => setMonth(budgetPeriod().start), 1000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    // SPA sign-out/sign-in preserves QueryClient; never reuse another user's data.
    queryKey: [...BUDGETS_QUERY_KEY, userId, month],
    queryFn: () => get(),
    refetchInterval: 30_000,
  });
  const data = query.data;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [currency, setCurrency] = useState("");
  const [limit, setLimit] = useState("");
  const [error, setError] = useState<BudgetError | "generic" | null>(null);
  const [notice, setNotice] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const mutation = useMutation({
    mutationFn: async (action: "save" | "delete") => {
      if (action === "delete") return remove({ data: { id: deleting!.id } });
      const parsed = budgetInput.safeParse({
        categoryId,
        currency,
        limitMinor: /^\d+(?:[.,]\d{1,2})?$/.test(limit.trim()) ? parseAmountToMinor(limit) : null,
      });
      if (!parsed.success) return { error: "invalid" as const };
      return editing
        ? edit({ data: { id: editing.id, currency, limitMinor: parsed.data.limitMinor } })
        : add({ data: parsed.data });
    },
    onSuccess: async (result, action) => {
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNotice(action === "delete" ? m.budget_deleted() : m.budget_saved());
      setFormOpen(false);
      setDeleting(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: BUDGETS_QUERY_KEY });
    },
    onError: () => setError("generic"),
  });
  function openForm(budget: Budget | null, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setNotice("");
    setError(null);
    setEditing(budget);
    setCategoryId(budget?.category_id ?? "");
    setLimit(budget ? formatMinor(budget.limit_minor) : "");
    setCurrency(budget?.currency ?? (data?.currencies.length === 1 ? data.currencies[0] : ""));
    setFormOpen(true);
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    (returnFocus.current?.isConnected ? returnFocus.current : addButton.current)?.focus();
  }
  const atLimit =
    data?.maxBudgets !== null &&
    data?.maxBudgets !== undefined &&
    data.items.length >= data.maxBudgets;
  const categoryOptions = (data?.categories ?? [])
    .map((category) => {
      const names = [category.name];
      const visited = new Set([category.id]);
      let parent = category.parent_id;
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        const ancestor = data?.categories.find((item) => item.id === parent);
        if (!ancestor) break;
        names.unshift(ancestor.name);
        parent = ancestor.parent_id;
      }
      return { ...category, path: names.join(" / "), depth: names.length - 1 };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return (
    <div className="min-h-full">
      <header className="border-b border-border bg-card/50">
        <div className="page-wrap py-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold display-title">{m.nav_budgets()}</h1>
            <p className="text-sm text-muted-foreground mt-1">{m.budget_intro()}</p>
          </div>
          <Button
            ref={addButton}
            onClick={(event) => openForm(null, event.currentTarget)}
            disabled={!data?.categories.length || !!atLimit}
          >
            <Plus aria-hidden="true" className="size-4" />
            {m.budget_add()}
          </Button>
        </div>
      </header>
      <main className="page-wrap py-8 space-y-6">
        <p className="sr-only" role="status">
          {notice}
        </p>
        {query.isPending ? (
          <p role="status">{m.budget_loading()}</p>
        ) : query.isError ? (
          <div role="alert">
            <p>{m.budget_error_generic()}</p>
            <Button onClick={() => void query.refetch()}>{m.budget_retry()}</Button>
          </div>
        ) : (
          data && (
            <>
              <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
                <p>{m.budget_month({ month: data.period.start.slice(0, 7) })}</p>
                <p>
                  {data.maxBudgets === null
                    ? m.budget_plan_pro()
                    : m.budget_plan_free({ count: data.items.length })}
                </p>
              </div>
              {atLimit && (
                <div className="rounded-lg border p-4 text-sm">
                  <p>{m.budget_error_limit()}</p>
                  <Link className="underline font-medium" to="/billing">
                    {m.budget_upgrade()}
                  </Link>
                </div>
              )}
              {!data.emailReady && (
                <p className="rounded-lg border p-4 text-sm">
                  {m.budget_email_warning()}{" "}
                  <Link to="/settings" className="underline">
                    {m.budget_settings()}
                  </Link>
                </p>
              )}
              {!data.categories.length && (
                <p>
                  {m.budget_no_categories()}{" "}
                  <Link className="underline" to="/categories">
                    {m.budget_categories_link()}
                  </Link>
                </p>
              )}
              {!data.items.length ? (
                <div className="island-shell rounded-xl py-16 px-6 text-center">
                  <Wallet
                    className="size-10 mx-auto mb-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h2 className="text-lg font-semibold">{m.budget_empty()}</h2>
                  <p className="text-muted-foreground mt-2">{m.budget_empty_help()}</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.items.map((budget) => {
                    const ratio = budget.spent / budget.limit_minor;
                    const warning = ratio >= 0.8 && !budget.exceeded;
                    const status = budget.exceeded
                      ? m.budget_over()
                      : ratio === 1
                        ? m.budget_at_limit()
                        : warning
                          ? m.budget_near_limit()
                          : budget.spent === 0
                            ? m.budget_not_started()
                            : m.budget_within();
                    const tone = budget.exceeded
                      ? "text-red-700 dark:text-red-400"
                      : warning
                        ? "text-amber-800 dark:text-amber-300"
                        : "text-muted-foreground";
                    return (
                      <section
                        key={budget.id}
                        aria-labelledby={`budget-${budget.id}`}
                        className={cn(
                          "island-shell rounded-xl p-5 min-w-0 flex flex-col",
                          budget.exceeded && "border-red-200 dark:border-red-900",
                        )}
                      >
                        <h2
                          id={`budget-${budget.id}`}
                          className="text-lg font-semibold break-words"
                        >
                          {budget.categoryName}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <p className={cn("font-medium flex items-center gap-1.5", tone)}>
                            {(budget.exceeded || warning) && (
                              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                            )}
                            {status}
                          </p>
                          <span className="text-muted-foreground tabular-nums">
                            {m.budget_percent_used({ percent: Math.round(ratio * 100) })}
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          className="h-2 mt-3 overflow-hidden rounded-full bg-[var(--line)]"
                          aria-valuemin={0}
                          aria-valuemax={budget.limit_minor}
                          aria-valuenow={Math.min(budget.spent, budget.limit_minor)}
                          aria-valuetext={m.budget_progress({
                            category: budget.categoryName,
                            spent: formatMoney(budget.spent, budget.currency),
                            limit: formatMoney(budget.limit_minor, budget.currency),
                          })}
                          aria-label={m.budget_progress({
                            category: budget.categoryName,
                            spent: formatMoney(budget.spent, budget.currency),
                            limit: formatMoney(budget.limit_minor, budget.currency),
                          })}
                        >
                          <div
                            className={cn(
                              "h-full rounded-full motion-safe:transition-[width]",
                              budget.exceeded
                                ? "bg-red-600 dark:bg-red-400"
                                : warning
                                  ? "bg-amber-600 dark:bg-amber-400"
                                  : "bg-[var(--lagoon-deep)]",
                            )}
                            style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                          />
                        </div>
                        <dl className="space-y-2 my-4 text-sm">
                          <div className="flex flex-wrap justify-between gap-2">
                            <dt className="text-muted-foreground">{m.budget_limit()}</dt>
                            <dd className="font-medium tabular-nums">
                              {formatMoney(budget.limit_minor, budget.currency)}
                            </dd>
                          </div>
                          <div className="flex flex-wrap justify-between gap-2">
                            <dt className="text-muted-foreground">{m.budget_spent()}</dt>
                            <dd className="font-medium tabular-nums">
                              {formatMoney(budget.spent, budget.currency)}
                            </dd>
                          </div>
                          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3 mt-3">
                            <dt className="font-medium">{m.budget_remaining()}</dt>
                            <dd
                              className={cn(
                                "text-xl font-semibold tabular-nums",
                                budget.exceeded && "text-red-700 dark:text-red-400",
                              )}
                            >
                              {formatMoney(budget.remaining, budget.currency)}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-auto pt-2 flex flex-wrap items-center justify-between gap-2">
                          <Button
                            variant="outline"
                            className="min-h-11"
                            aria-label={m.budget_edit_category({ category: budget.categoryName })}
                            onClick={(event) => openForm(budget, event.currentTarget)}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            {m.budget_edit()}
                          </Button>
                          <Button
                            variant="ghost"
                            className="min-h-11 text-muted-foreground hover:text-red-700 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30"
                            aria-label={m.budget_delete_category({ category: budget.categoryName })}
                            onClick={(event) => {
                              returnFocus.current = event.currentTarget;
                              setError(null);
                              setDeleting(budget);
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            {m.delete()}
                          </Button>
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )
        )}
      </main>
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!mutation.isPending) {
            setFormOpen(open);
            setError(null);
          }
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus} showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{editing ? m.budget_edit() : m.budget_add()}</DialogTitle>
            <DialogDescription>{m.budget_form_help()}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              mutation.mutate("save");
            }}
            className="space-y-4"
          >
            {error && (
              <p
                id="budget-form-error"
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="text-sm font-medium"
              >
                {errorMessage(error)}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="budget-category">{m.budget_category()}</Label>
              <Select
                id="budget-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                disabled={!!editing || mutation.isPending}
                required
                aria-invalid={error === "invalid" || error === "duplicate"}
                aria-describedby={error ? "budget-form-error" : undefined}
              >
                <SelectItem value="">{m.budget_choose_category()}</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {"—".repeat(c.depth)} {c.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget-currency">{m.budget_currency()}</Label>
              <Input
                id="budget-currency"
                className="w-20 font-mono"
                value={currency}
                maxLength={3}
                placeholder="PLN"
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                required
                disabled={mutation.isPending}
                aria-invalid={error === "invalid"}
                aria-describedby={
                  error ? "budget-currency-help budget-form-error" : "budget-currency-help"
                }
              />
              <p id="budget-currency-help" className="text-xs text-muted-foreground">
                {m.budget_currency_help()}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget-limit">{m.budget_limit()}</Label>
              <Input
                id="budget-limit"
                type="number"
                step="0.01"
                min="0.01"
                max="21474836.47"
                inputMode="decimal"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                required
                disabled={mutation.isPending}
                aria-invalid={error === "invalid"}
                aria-describedby={error ? "budget-form-error" : undefined}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setFormOpen(false)}
              >
                {m.budget_cancel()}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? m.budget_saving()
                  : editing
                    ? m.budget_save()
                    : m.budget_create()}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) {
            setDeleting(null);
            setError(null);
          }
        }}
      >
        <DialogContent showCloseButton={false} onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>{m.budget_delete()}</DialogTitle>
            <DialogDescription>
              {m.budget_delete_help({ category: deleting?.categoryName ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert">
              {errorMessage(error)}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setDeleting(null)}
            >
              {m.budget_cancel()}
            </Button>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("delete")}
            >
              {mutation.isPending ? m.budget_deleting() : m.budget_delete()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
