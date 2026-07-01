import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembershipIdentityPanel } from "@/components/membership-identity-panel";

describe("MembershipIdentityPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches to attached state after attaching a verified session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/identity/session") {
        return jsonResponse({
          signedIn: true,
          normalizedEmail: "ada@example.com",
          expiresAt: Date.now() + 1_000,
        });
      }
      if (url === "/api/identity/attach-membership") {
        return jsonResponse({
          membershipId: "member-1",
          emailIdentityId: "email-1",
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MembershipIdentityPanel membershipToken="member-secret" />);

    const attachButton = await screen.findByRole("button", {
      name: /attach to this membership/i,
    });
    fireEvent.click(attachButton);

    await waitFor(() =>
      expect(
        screen.getByText(/this membership has email recovery attached/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /attach to this membership/i }),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/identity/attach-membership",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ membershipToken: "member-secret" }),
      }),
    );
  });

  it("syncs attached state when membership data refreshes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          signedIn: true,
          normalizedEmail: "ada@example.com",
          expiresAt: Date.now() + 1_000,
        }),
      ),
    );

    const { rerender } = render(
      <MembershipIdentityPanel membershipToken="member-secret" />,
    );
    expect(
      await screen.findByRole("button", { name: /attach to this membership/i }),
    ).toBeInTheDocument();

    rerender(
      <MembershipIdentityPanel membershipToken="member-secret" isEmailRecoveryAttached />,
    );

    expect(
      screen.getByText(/this membership has email recovery attached/i),
    ).toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}
