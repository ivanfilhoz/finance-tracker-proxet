import { BUDGETS_QUERY_KEY } from "#/lib/budgets";
import { MutationCache, QueryClient } from "@tanstack/react-query";

export function getContext() {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      // Budgets depend on transactions, imports, categories, accounts and plans.
      // Invalidate even on partial failure; a streamed import may have committed rows.
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: BUDGETS_QUERY_KEY }); },
    }),
  });

  return {
    queryClient,
  };
}
export default function TanstackQueryProvider() {}
