import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "#/server/session";
import { reconcileBudgets } from "#/server/budget-alerts.server";

export const Route = createFileRoute("/test-budget-sweep")({
  server: {
    handlers: {
      POST: async () => {
        if (process.env.TEST_MODE !== "1") return new Response("Not available", { status: 404 });
        // Same per-user operation as the background sweep; isolated from other tests.
        await reconcileBudgets(await requireUserId());
        return Response.json({ ok: true });
      },
    },
  },
});
