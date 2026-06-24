"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexClient = useMemo(() => {
    if (!convexUrl) {
      throw new Error(
        "Missing NEXT_PUBLIC_CONVEX_URL. Run `npm run convex:dev` to generate local env values.",
      );
    }

    return new ConvexReactClient(convexUrl);
  }, []);

  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
