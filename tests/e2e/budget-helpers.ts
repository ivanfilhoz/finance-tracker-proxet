import { expect, type Page } from "./fixtures";

export async function selectBudgetCategory(page: Page, category: string) {
  const select = page.getByLabel("Category", { exact: true });
  const labels = await select.getByRole("option").allTextContents();
  const index = labels.findIndex((label) => label.replace(/^[—\s]+/, "") === category);
  expect(index).toBeGreaterThanOrEqual(0);
  await select.selectOption({ index });
}

export async function createBudget(page: Page, category = "Groceries", limit = "100") {
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  await selectBudgetCategory(page, category);
  await page.getByLabel("Currency", { exact: true }).fill("PLN");
  await page.getByLabel("Monthly limit").fill(limit);
  await page.getByRole("button", { name: "Create budget", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("region", { name: category, exact: true })).toBeVisible();
}

export async function createCategory(page: Page, name: string, parent?: string) {
  await page.goto("/categories");
  await page.getByRole("button", { name: "Add Category" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  if (parent) await page.getByLabel("Parent Category").selectOption({ label: parent });
  await page.getByRole("button", { name: "Create Category", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

export async function transaction(
  page: Page,
  amount: string,
  opts: { category?: string; date?: string; income?: boolean; description?: string } = {},
) {
  await page.goto("/transactions");
  await page.getByRole("banner").getByRole("button", { name: "Add Transaction" }).click();
  const modal = page.getByRole("dialog", { name: "New Transaction" });
  await modal
    .getByLabel("Date", { exact: true })
    .fill(`${opts.date ?? new Date().toISOString().slice(0, 10)}T12:00`);
  await modal
    .getByLabel("Description")
    .fill(opts.description ?? `Budget expense ${crypto.randomUUID()}`);
  await modal.getByRole("spinbutton", { name: "Amount", exact: true }).fill(amount);
  await modal.getByLabel("Account", { exact: true }).selectOption({ label: "Main (PLN)" });
  const categoryName = opts.category ?? "Groceries";
  const options = modal.getByLabel("Category", { exact: true }).getByRole("option");
  const labels = await options.allTextContents();
  const index = labels.findIndex((label) => label.replace(/^[—\s]+/, "") === categoryName);
  expect(index).toBeGreaterThanOrEqual(0);
  const value = await options.nth(index).getAttribute("value");
  await modal.getByLabel("Category", { exact: true }).selectOption(value!);
  if (opts.income) await modal.getByLabel("Income").check();
  await modal.getByRole("button", { name: "Create Transaction" }).click();
  await expect(modal).toBeHidden();
}

export async function budgetEmails(page: Page, username: string) {
  const response = await page.request.get(
    `/test-emails?to=${encodeURIComponent(`${username}@example.com`)}`,
  );
  const { emails } = (await response.json()) as {
    emails: { to: string; subject: string; text: string }[];
  };
  return emails.filter((email) => email.subject.startsWith("Budget exceeded:"));
}
