"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { readRememberedMembershipTokens } from "@/lib/membership-session";

const importedTokensStorageKey = "meeting-scheduler.imported-membership-tokens";

export function UserMembershipImporter({
  membershipTokens,
}: {
  membershipTokens?: string[];
}) {
  const router = useRouter();

  useEffect(() => {
    const tokens = Array.from(
      new Set(
        (membershipTokens ?? readRememberedMembershipTokens())
          .map((token) => token.trim())
          .filter(Boolean),
      ),
    );
    if (tokens.length === 0) {
      return;
    }

    let importedTokens = new Set<string>();
    try {
      importedTokens = new Set(
        JSON.parse(sessionStorage.getItem(importedTokensStorageKey) ?? "[]"),
      );
    } catch {
      importedTokens = new Set();
    }
    const pendingTokens = tokens.filter((token) => !importedTokens.has(token));
    if (pendingTokens.length === 0) {
      return;
    }

    let cancelled = false;
    void fetch("/api/user/import-memberships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipTokens: pendingTokens }),
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        const body = (await response.json()) as { importedMembershipIds?: string[] };
        for (const token of pendingTokens) {
          importedTokens.add(token);
        }
        sessionStorage.setItem(
          importedTokensStorageKey,
          JSON.stringify(Array.from(importedTokens)),
        );
        if (!cancelled && (body.importedMembershipIds?.length ?? 0) > 0) {
          router.refresh();
        }
      })
      .catch(() => {
        // Import is opportunistic; token links remain the authority for editing.
      });

    return () => {
      cancelled = true;
    };
  }, [membershipTokens, router]);

  return null;
}
