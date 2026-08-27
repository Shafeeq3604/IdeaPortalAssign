import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./query-client";

/** App-wide providers. The client factory and its defaults live in ./query-client. */

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
