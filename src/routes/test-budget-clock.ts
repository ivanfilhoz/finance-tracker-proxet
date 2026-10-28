import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "#/server/session";
import { setBudgetTestClock } from "#/server/budget-clock.server";

export const Route = createFileRoute("/test-budget-clock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env.TEST_MODE !== "1") return new Response("Not available", { status: 404 });
        const userId = await requireUserId();
        const raw = new URL(request.url).searchParams.get("now") ?? "";
        const now = new Date(raw);
        if (!Number.isFinite(now.getTime())) return new Response("Invalid date", { status: 400 });
        setBudgetTestClock(userId, now);

        return Response.json({ ok: true });
      },
    },
  },
});
