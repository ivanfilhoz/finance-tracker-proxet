// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { env } from "../src/server/env";
import { sendEmail } from "../src/server/email";

const originalProvider = env.email.provider;
afterEach(() => {
  env.email.provider = originalProvider;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("aborts a stalled provider and releases its timeout without retrying", async () => {
  env.email.provider = "resend";
  vi.useFakeTimers();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  const delivery = sendEmail({
    to: "fixture@example.com",
    subject: "Budget exceeded",
    text: "Fixture",
  });
  const rejected = expect(delivery).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the deadline after successful delivery", async () => {
  env.email.provider = "resend";
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  await sendEmail({ to: "fixture@example.com", subject: "Fixture", text: "Fixture" });
  expect(vi.getTimerCount()).toBe(0);
});
