import { test, expect } from "./fixtures";
import { createBudget, transaction, budgetEmails } from "./budget-helpers";

test.beforeEach(async ({ signedInUser }) => {
  void signedInUser;
});

test("B7: mutation alerts once; refund, re-crossing, lower limit and reload do not duplicate", async ({
  page,
  signedInUser,
}) => {
  await createBudget(page);
  await transaction(page, "100", { description: "Threshold" });
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(0);
  await transaction(page, "0.01", { description: "Crossing" });
  await expect.poll(async () => (await budgetEmails(page, signedInUser.username)).length).toBe(1);
  const [email] = await budgetEmails(page, signedInUser.username);
  expect(email.to).toBe(`${signedInUser.username}@example.com`);
  expect(email.text).toContain("100.01 PLN");
  expect(email.subject).toContain("Groceries");
  // Edit the crossing transaction below and above the threshold again.
  await page.goto("/transactions");
  const row = page.getByTestId("transaction-row").filter({ hasText: "Threshold" });
  await row.getByTestId("edit-transaction").click();
  await page
    .getByRole("dialog")
    .getByRole("spinbutton", { name: "Amount", exact: true })
    .fill("50");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await transaction(page, "100", { income: true, description: "Refund" });
  await transaction(page, "51");
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Edit budget for Groceries" }).click();
  await page.getByLabel("Monthly limit").fill("25");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(1);
});

test("B7/B9: CSV import and re-categorization reconcile alerts without opening budgets", async ({
  page,
  signedInUser,
}) => {
  await createBudget(page, "Groceries", "20");
  await page.goto("/import");
  await page.locator('input[type="file"][accept=".csv"]').setInputFiles({
    name: "budget.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Date,Amount,Description,Category\n${new Date().toISOString().slice(0, 10)},-30.00,BIEDRONKA Sklep,\n`,
    ),
  });
  await expect(page.getByRole("combobox", { name: "Date", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Account", exact: true })
    .selectOption({ label: "Main (PLN)" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Confirm Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();
  await expect.poll(async () => (await budgetEmails(page, signedInUser.username)).length).toBe(1);
  await createBudget(page, "Snacks & Sweets", "20");
  expect(
    (
      await page.request.post("/test-add-rule", {
        data: { pattern: "Biedronka", categoryName: "Snacks & Sweets", priority: 1 },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/categorization");
  await page.getByTestId("re-categorize-btn").click();
  await page.getByTestId("recat-mode-overwrite").check();
  await page.getByTestId("recategorize-run").click();
  await expect(page.getByTestId("recategorize-result")).toBeVisible();
  await expect.poll(async () => (await budgetEmails(page, signedInUser.username)).length).toBe(2);
  const emails = await budgetEmails(page, signedInUser.username);
  expect(emails.map((email) => email.subject)).toContain("Budget exceeded: Snacks & Sweets");
});

test("B6/B7: next month resets spending, retains the limit and permits one new email", async ({
  page,
  signedInUser,
}) => {
  await page.request.post("/test-budget-clock?now=2026-10-15T12:00:00Z");
  await createBudget(page);
  await transaction(page, "101", { date: "2026-10-15" });
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(1);
  expect((await page.request.post("/test-budget-clock?now=2026-11-01T00:00:00Z")).ok()).toBe(true);
  await page.goto("/budgets");
  const card = page.getByRole("region", { name: "Groceries", exact: true });
  await expect(card.locator("dd")).toHaveText(["100.00 PLN", "0.00 PLN", "100.00 PLN"]);
  await expect(page.getByText("Month: 2026-11 (UTC)")).toBeVisible();
  await transaction(page, "101", { date: "2026-11-01" });
  await transaction(page, "1", { date: "2026-11-02" });
  const emails = await budgetEmails(page, signedInUser.username);
  expect(emails).toHaveLength(2);
  expect(emails[0].text).toContain("2026-10");
  expect(emails[1].text).toContain("2026-11");
});

test("B6/B7: scheduled sweep catches a future expense at rollover without another edit", async ({
  page,
  signedInUser,
}) => {
  await page.request.post("/test-budget-clock?now=2026-10-31T23:59:00Z");
  await createBudget(page);
  await transaction(page, "101", { date: "2026-11-01" });
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(0);
  await page.request.post("/test-budget-clock?now=2026-11-01T00:00:01Z");
  await page.goto("/budgets");
  await expect(page.getByRole("region", { name: "Groceries", exact: true })).toContainText(
    "Over budget",
  );
  // Reading the page must not send mail; the background reconciliation does.
  expect(await budgetEmails(page, signedInUser.username)).toHaveLength(0);
  expect((await page.request.post("/test-budget-sweep")).ok()).toBe(true);
  expect((await page.request.post("/test-budget-sweep")).ok()).toBe(true);
  const emails = await budgetEmails(page, signedInUser.username);
  expect(emails).toHaveLength(1);
  expect(emails[0].text).toContain("2026-11");
});
