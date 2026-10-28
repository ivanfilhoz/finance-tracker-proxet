// Per-user test clock: production always uses real time. Parallel E2E tests
// must never change a process-wide clock or another user's calendar window.
const testClocks = new Map<string, Date>();
export function budgetNow(userId: string): Date {
  return process.env.TEST_MODE === "1" ? (testClocks.get(userId) ?? new Date()) : new Date();
}
export function setBudgetTestClock(userId: string, now: Date): void {
  if (process.env.TEST_MODE !== "1") throw new Error("Test clock unavailable");
  testClocks.set(userId, now);
}
