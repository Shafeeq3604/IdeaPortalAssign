import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * The QueryClientProvider + MemoryRouter wrapper every page-level component test needs —
 * these pages read `useSearchParams`/`useParams` and TanStack Query hooks directly, so
 * neither can be left out. `retry: false` is the only override: the default 3-retry
 * backoff would make every deliberately-errored fetch in these tests take real seconds.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/", queryClient }: { route?: string; queryClient?: QueryClient } = {},
) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
