import AxeBuilder from "@axe-core/playwright";
import { strFromU8, unzipSync } from "fflate";
import { test, expect } from "./fixtures";
import { createBudget, createCategory, transaction, selectBudgetCategory } from "./budget-helpers";

test("B1: unauthenticated visitors cannot open budgets", async ({ page, unauthUser }) => {
  void unauthUser;
  await page.goto("/budgets");
  await expect(page).toHaveURL(/\/login/);
});

test.describe("Budgets", () => {
  test.beforeEach(async ({ page, signedInUser }) => {
    void signedInUser;
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Budgets", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Budgets", exact: true })).toBeVisible();
  });

  test("B1/B2: empty state, persistent CRUD and validation", async ({ page }) => {
    await expect(page.getByText("No budgets yet")).toBeVisible();
    await page.getByRole("button", { name: "Add budget", exact: true }).click();
    await page.getByRole("button", { name: "Create budget" }).click();
    await expect(page.getByRole("alert")).toContainText("Enter a valid");
    await expect(page.getByLabel("Monthly limit")).toHaveAttribute(
      "aria-describedby",
      "budget-form-error",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await createBudget(page);
    await page.reload();
    const card = page.getByRole("region", { name: "Groceries", exact: true });
    await expect(card).toContainText("100.00 PLN");
    await page.getByRole("button", { name: "Add budget", exact: true }).click();
    await selectBudgetCategory(page, "Groceries");
    await page.getByLabel("Monthly limit").fill("50");
    await page.getByRole("button", { name: "Create budget" }).click();
    await expect(page.getByRole("alert")).toContainText("already has a budget");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await card.getByRole("button", { name: "Edit budget for Groceries" }).click();
    await expect(page.getByLabel("Monthly limit")).toHaveAttribute("type", "number");
    await expect(page.getByLabel("Monthly limit")).toHaveAttribute("step", "0.01");
    await page.getByLabel("Monthly limit").fill("125.501");
    await page.getByRole("button", { name: "Save budget", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Enter a valid");
    await page.getByLabel("Currency", { exact: true }).fill("pln");
    await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("PLN");
    await page.getByLabel("Monthly limit").fill("125.50");
    await page.getByRole("button", { name: "Save budget", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.reload();
    await expect(card).toContainText("125.50 PLN");
    await card.getByRole("button", { name: "Delete budget for Groceries" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete budget", exact: true })
      .click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("B3/B4/B5/B6: descendant expenses, exact threshold, refunds and month filtering", async ({
    page,
  }) => {
    await createCategory(page, "Budget Child");
    await createCategory(page, "Budget Grandchild", "Budget Child");
    await createCategory(page, "Budget Parent");
    await page
      .getByTestId("category-row")
      .filter({ hasText: "Budget Child" })
      .getByTestId("edit-category")
      .click();
    await page.getByLabel("Parent Category").selectOption({ label: "Budget Parent" });
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await createBudget(page, "Budget Parent");
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
      .toISOString()
      .slice(0, 10);
    await transaction(page, "500", { category: "Budget Child", date: previous });
    await transaction(page, "60", { category: "Budget Parent" });
    await transaction(page, "40", { category: "Budget Grandchild" });
    await transaction(page, "20", {
      category: "Budget Child",
      income: true,
      description: "Refund",
    });
    await transaction(page, "1000", {
      category: "Budget Parent",
      income: true,
      description: "Income",
    });
    await page.goto("/budgets");
    const card = page.getByRole("region", { name: "Budget Parent", exact: true });
    await expect(card).toContainText("Limit reached");
    await expect(card.locator("dd")).toHaveText(["100.00 PLN", "100.00 PLN", "0.00 PLN"]);
    await transaction(page, "0.01", { category: "Budget Child" });
    await page.goto("/budgets");
    await expect(card).toContainText("Over budget");
    await expect(card.locator("dd")).toHaveText(["100.00 PLN", "100.01 PLN", "-0.01 PLN"]);
    await page.reload();
    await expect(card).toContainText("100.01 PLN");
  });

  test("UX: navigation, empty/partial/near/full/exceeded progress and safe actions", async ({
    page,
  }, testInfo) => {
    await createBudget(page);
    const card = page.getByRole("region", { name: "Groceries", exact: true });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link").first()).toHaveText("Dashboard");
    const navBudget = nav.getByRole("link", { name: "Budgets", exact: true });
    await expect(navBudget).toHaveAttribute("aria-current", "page");
    await expect(navBudget.locator("svg")).toHaveAttribute("stroke-width", "1.8");
    const iconColors = await nav
      .locator('a[href="/dashboard"] svg, a[href="/budgets"] svg')
      .evaluateAll((icons) => icons.map((icon) => getComputedStyle(icon).color));
    expect(iconColors[0]).toBe(iconColors[1]);
    await expect(card).toContainText("No spending yet");
    await expect(card).toContainText("0% used");
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await expect(card.getByRole("progressbar").locator("div")).toHaveCSS("width", "0px");
    await transaction(page, "60");
    await page.goto("/budgets");
    await expect(card).toContainText("Within budget");
    await expect(card).toContainText("60% used");
    for (const [limit, status, percentage] of [
      ["75", "Near limit", "80% used"],
      ["60", "Limit reached", "100% used"],
      ["50", "Over budget", "120% used"],
    ]) {
      await card.getByRole("button", { name: "Edit budget for Groceries" }).click();
      await page.getByLabel("Monthly limit").fill(limit);
      await page.getByRole("button", { name: "Save budget" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(card).toContainText(status);
      await expect(card).toContainText(percentage);
    }
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "Groceries: 60.00 PLN spent of 50.00 PLN",
    );
    for (const dark of [false, true]) {
      await page.evaluate(
        (enabled) => document.documentElement.classList.toggle("dark", enabled),
        dark,
      );
      const audit = await new AxeBuilder({ page })
        .include("main")
        .include("header:has(h1)")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`budgets-exceeded-${dark ? "dark" : "light"}.png`),
        fullPage: true,
      });
    }
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    const remove = card.getByRole("button", { name: "Delete budget for Groceries" });
    await remove.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("dialog", { name: "Delete budget", exact: true });
    await expect(confirmation).toContainText("Your transactions will be kept");
    await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(remove).toBeFocused();
    await expect(card).toBeVisible();
  });

  test("B8: Free cap, Pro upgrade and downgrade preserving records", async ({ page }) => {
    for (let i = 0; i < 5; i++) await createCategory(page, `Budget cap ${i}`);
    for (let i = 0; i < 3; i++) await createBudget(page, `Budget cap ${i}`);
    await expect(page.getByRole("button", { name: "Add budget", exact: true })).toBeDisabled();
    await expect(page.getByText(/Free supports up to 3 budgets/)).toBeVisible();
    expect((await page.request.post("/test-set-plan?plan=pro")).ok()).toBe(true);
    await createBudget(page, "Budget cap 3");
    await createBudget(page, "Budget cap 4");
    await expect(page.getByText("Pro · unlimited budgets")).toBeVisible();
    expect((await page.request.post("/test-set-plan?plan=free")).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("region")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Add budget", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Edit budget for Budget cap 0", exact: true }).click();
    await page.getByLabel("Monthly limit").fill("200");
    await page.getByRole("button", { name: "Save budget" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("region", { name: "Budget cap 0", exact: true })).toContainText(
      "200.00 PLN",
    );
  });

  test("B10: export includes owned budgets and alerts; deletion removes account", async ({
    page,
    signedInUser,
  }) => {
    await createBudget(page);
    await transaction(page, "101");
    const response = await page.request.get("/api/export-data");
    expect(response.ok()).toBe(true);
    const files = unzipSync(new Uint8Array(await response.body()));
    const data = JSON.parse(strFromU8(files["export.json"]));
    expect(data.budgets).toHaveLength(1);
    expect(data.budgets[0].user_id).toBe(signedInUser.userId);
    expect(data.budgetNotifications).toHaveLength(1);
    expect(data.budgetNotifications[0].state).toBe("sent");
    expect(files["budgets.csv"]).toBeDefined();
    expect(files["budget_notifications.csv"]).toBeDefined();
    await page.goto("/settings");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Request deletion" }).click();
    await expect(page.getByTestId("deletion-pending-banner")).toBeVisible();
    expect(
      (
        await page.request.post(`/test-backdate?userId=${signedInUser.userId}&deletionDays=15`)
      ).ok(),
    ).toBe(true);
    expect((await page.request.post("/test-run-sweep")).ok()).toBe(true);
    await page.goto("/budgets");
    await expect(page).toHaveURL(/\/(login|setup)/);
    expect((await page.request.get("/api/export-data")).status()).toBe(401);
  });

  test("accessibility: axe, keyboard focus, errors, dialogs and responsive layout", async ({
    page,
  }, testInfo) => {
    await createBudget(page);
    let result = await new AxeBuilder({ page })
      .include("main")
      .include("header:has(h1)")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    const trigger = page.getByRole("button", { name: "Add budget", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add budget", exact: true });
    await expect(page.getByLabel("Category", { exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Create budget" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toBeFocused();
    result = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("budgets-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("region", { name: "Groceries", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("budgets-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Edit budget for Groceries" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth),
    ).toBe(true);
  });
});
