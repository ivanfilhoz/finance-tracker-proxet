import { test, expect } from "./fixtures";
import { createBudget, createCategory, transaction, budgetEmails } from "./budget-helpers";
import { unzipSync, strFromU8 } from "fflate";

test("regression: switching users never displays the previous user's cached budgets", async ({
  page,
  signedInUser: _signedInUser,
  unauthUser,
}) => {
  await createBudget(page);
  await page.evaluate(() => {
    Object.assign(window, { budgetSessionMarker: "same-document" });
  });
  await page.getByRole("link", { name: "Sign out" }).nth(1).click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Email or username").fill(unauthUser.username);
  await page.getByLabel("Password").fill(unauthUser.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
  expect(await page.evaluate(() => Reflect.get(window, "budgetSessionMarker"))).toBe(
    "same-document",
  );

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let budgetResponsePending = false;
  await page.route("**/_serverFn/**", async (route) => {
    const response = await route.fetch();
    if ((await response.text()).includes("maxBudgets")) {
      budgetResponsePending = true;
      await gate;
    }
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("link", { name: "Budgets", exact: true }).click();
    await expect.poll(() => budgetResponsePending).toBe(true);
    await expect(page.getByRole("region", { name: "Groceries", exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "Add budget", exact: true })).toBeEnabled();
  await expect(page.getByRole("region")).toHaveCount(0);
});

test("regression: editing dates/signs and deleting transactions refreshes budgets without duplicate alerts", async ({
  page,
  signedInUser,
}) => {
  await createBudget(page);
  await transaction(page, "101", { description: "Regression expense" });
  const card = page.getByRole("region", { name: "Groceries", exact: true });
  const today = new Date().toISOString().slice(0, 10);
  const previous = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0))
    .toISOString()
    .slice(0, 10);
  for (const [date, income, spent] of [
    [previous, false, "0.00 PLN"],
    [today, true, "0.00 PLN"],
    [today, false, "101.00 PLN"],
  ] as const) {
    await page.goto("/transactions");
    await page
      .getByTestId("transaction-row")
      .filter({ hasText: "Regression expense" })
      .getByTestId("edit-transaction")
      .click();
    const dialog = page.getByRole("dialog", { name: "Edit Transaction" });
    await dialog.getByLabel("Date", { exact: true }).fill(`${date}T12:00`);
    await dialog.getByLabel("Income", { exact: true }).setChecked(income);
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();
    await page.goto("/budgets");
    await expect(card.locator("dd").nth(1)).toHaveText(spent);
  }
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(1);
  await page.goto("/transactions");
  await page
    .getByTestId("transaction-row")
    .filter({ hasText: "Regression expense" })
    .getByTestId("delete-transaction")
    .click();
  await page
    .getByRole("alertdialog", { name: "Delete Transaction" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await page.goto("/budgets");
  await expect(card.locator("dd")).toHaveText(["100.00 PLN", "0.00 PLN", "100.00 PLN"]);
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(1);
});

test("regression: account and budget currency changes recompute spending without mixing currencies", async ({
  page,
  signedInUser,
}) => {
  await createBudget(page);
  await transaction(page, "101");
  await page.goto("/accounts");
  await page.getByTestId("edit-account").click();
  await page.getByLabel("Currency", { exact: true }).fill("USD");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goto("/budgets");
  const card = page.getByRole("region", { name: "Groceries", exact: true });
  await expect(card.locator("dd")).toHaveText(["100.00 PLN", "0.00 PLN", "100.00 PLN"]);
  await card.getByRole("button", { name: "Edit budget for Groceries" }).click();
  await page.getByLabel("Currency", { exact: true }).fill("USD");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(card.locator("dd")).toHaveText(["100.00 USD", "101.00 USD", "-1.00 USD"]);
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(1);
});

test("regression: category deletion reassigns spending and cascades only the removed budget", async ({
  page,
  signedInUser,
}) => {
  await createCategory(page, "Old budget category");
  await createCategory(page, "Retained budget category");
  await createBudget(page, "Old budget category");
  await createBudget(page, "Retained budget category");
  await transaction(page, "101", {
    category: "Old budget category",
    description: "Retained expense",
  });
  await page.goto("/categories");
  await page
    .getByTestId("category-row")
    .filter({ hasText: "Old budget category" })
    .getByTestId("delete-category")
    .click();
  await page
    .getByLabel("Reassign transactions to")
    .selectOption({ label: "Retained budget category" });
  await page
    .getByRole("alertdialog", { name: "Delete Category" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await page.goto("/budgets");
  await expect(page.getByRole("region")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Retained budget category", exact: true }).locator("dd"),
  ).toHaveText(["100.00 PLN", "101.00 PLN", "-1.00 PLN"]);
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(2);
  const response = await page.request.get("/api/export-data");
  const files = unzipSync(new Uint8Array(await response.body()));
  const data = JSON.parse(strFromU8(files["export.json"]));
  expect(data.budgets).toHaveLength(1);
  expect(data.budgetNotifications).toHaveLength(1);
  expect(data.budgetNotifications[0].budget_id).toBe(data.budgets[0].id);
  expect(data.transactions).toHaveLength(1);
  expect(data.transactions[0].category_id).toBe(data.budgets[0].category_id);
});
