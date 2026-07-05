import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createMeeting } from "./meetings/route";
import { GET as readMeeting } from "./meetings/[slug]/route";
import { GET as readRecommendations } from "./meetings/[slug]/recommendations/route";
import { PUT as saveAvailability } from "./meetings/[slug]/participants/[membershipId]/availability/route";
import { POST as finalizeMeeting } from "./meetings/[slug]/finalize/route";
import { POST as reopenMeeting } from "./meetings/[slug]/reopen/route";
import { POST as createToken } from "./tokens/route";
import { DELETE as revokeToken } from "./tokens/[tokenFingerprint]/route";

const { getIdentitySessionSecretMock, mutationMock, queryMock, verifySessionMock } =
  vi.hoisted(() => ({
    getIdentitySessionSecretMock: vi.fn(),
    mutationMock: vi.fn(),
    queryMock: vi.fn(),
    verifySessionMock: vi.fn(),
  }));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(function ConvexHttpClient() {
    return {
      mutation: mutationMock,
      query: queryMock,
    };
  }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentApi: {
      createApiToken: "agentApi:createApiToken",
      revokeApiToken: "agentApi:revokeApiToken",
      createMeeting: "agentApi:createMeeting",
      readMeeting: "agentApi:readMeeting",
      readRecommendations: "agentApi:readRecommendations",
      saveAvailability: "agentApi:saveAvailability",
      finalizeMeeting: "agentApi:finalizeMeeting",
      reopenMeeting: "agentApi:reopenMeeting",
    },
  },
}));

vi.mock("@/lib/identity-internal", () => ({
  getConvexUrl: () => "https://convex.example.com",
  getInternalIdentitySecret: () => "internal-secret",
}));

vi.mock("@/lib/identity-session", () => ({
  getIdentitySessionSecret: getIdentitySessionSecretMock,
  identitySessionCookieName: "ms_email_session",
  verifyEmailIdentitySession: verifySessionMock,
}));

describe("agent API routes", () => {
  beforeEach(() => {
    mutationMock.mockReset();
    queryMock.mockReset();
    getIdentitySessionSecretMock.mockReset();
    getIdentitySessionSecretMock.mockReturnValue("session-secret-session-secret-session");
    verifySessionMock.mockReset();
  });

  it("requires bearer authentication before creating meetings", async () => {
    const response = await createMeeting(
      new Request("https://localhost/api/v1/meetings", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "missing_bearer",
        message: "Bearer API token is required.",
      },
    });
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("hashes bearer tokens before calling Convex and never echoes the raw token", async () => {
    mutationMock.mockResolvedValueOnce({
      meetingId: "meeting-1",
      slug: "research-sync",
      adminMembershipId: "membership-1",
      tokenFingerprint: "fingerprint-1",
    });

    const response = await createMeeting(
      new Request("https://localhost/api/v1/meetings", {
        method: "POST",
        headers: {
          authorization: "Bearer ms_api_raw-secret",
        },
        body: JSON.stringify({
          title: "Research Sync",
          settings: {
            allowedTimeRanges: [
              {
                startUtc: "2026-07-06T09:00:00.000Z",
                endUtc: "2026-07-06T12:00:00.000Z",
              },
            ],
          },
        }),
      }),
    );
    const body = await response.json();
    const [, convexArgs] = mutationMock.mock.calls[0];

    expect(response.status).toBe(201);
    expect(convexArgs.tokenHash).toMatch(/^sha256:/u);
    expect(JSON.stringify(convexArgs)).not.toContain("ms_api_raw-secret");
    expect(JSON.stringify(body)).not.toContain("ms_api_raw-secret");
    expect(body.slug).toBe("research-sync");
  });

  it("reads public meeting state without bearer auth and preserves privacy-filtered results", async () => {
    queryMock.mockResolvedValueOnce({
      meeting: { slug: "research-sync", title: "Research Sync" },
      viewer: null,
      capabilities: { canAdminister: false },
      results: {
        detailsVisible: false,
        shortlist: [{ rank: 1, availableParticipantCount: 2 }],
      },
    });

    const response = await readMeeting(
      new Request("https://localhost/api/v1/meetings/research-sync"),
      { params: Promise.resolve({ slug: "research-sync" }) },
    );
    const body = await response.json();
    const [, convexArgs] = queryMock.mock.calls[0];

    expect(response.status).toBe(200);
    expect(convexArgs).toEqual({
      tokenHash: undefined,
      slug: "research-sync",
    });
    expect(body.results.detailsVisible).toBe(false);
    expect(JSON.stringify(body)).not.toContain("participantDetails");
  });

  it("returns recommendations as the direct meeting-results payload", async () => {
    queryMock.mockResolvedValueOnce({
      detailsVisible: false,
      shortlist: [{ rank: 1, availableParticipantCount: 2 }],
    });

    const response = await readRecommendations(
      new Request("https://localhost/api/v1/meetings/research-sync/recommendations"),
      { params: Promise.resolve({ slug: "research-sync" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      detailsVisible: false,
      shortlist: [{ rank: 1, availableParticipantCount: 2 }],
    });
    expect(body.recommendations).toBeUndefined();
  });

  it("maps finalized meeting availability writes to the stable conflict error", async () => {
    mutationMock.mockRejectedValueOnce(
      new Error("Finalized meetings are read-only until reopened"),
    );

    const response = await saveAvailability(
      new Request(
        "https://localhost/api/v1/meetings/research-sync/participants/membership-1/availability",
        {
          method: "PUT",
          headers: { authorization: "Bearer ms_api_raw-secret" },
          body: JSON.stringify({ records: [] }),
        },
      ),
      {
        params: Promise.resolve({
          slug: "research-sync",
          membershipId: "membership-1",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toEqual({
      code: "conflict",
      message: "The meeting lifecycle does not allow this write.",
    });
  });

  it("maps missing admin authority during finalization to forbidden", async () => {
    mutationMock.mockRejectedValueOnce(
      new Error("API token owner cannot administer this meeting"),
    );

    const response = await finalizeMeeting(
      new Request("https://localhost/api/v1/meetings/research-sync/finalize", {
        method: "POST",
        headers: { authorization: "Bearer ms_api_raw-secret" },
        body: JSON.stringify({
          finalizedSlot: {
            startUtc: "2026-07-06T09:00:00.000Z",
            endUtc: "2026-07-06T10:00:00.000Z",
          },
        }),
      }),
      { params: Promise.resolve({ slug: "research-sync" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("maps missing finalize scope during reopen to insufficient_scope", async () => {
    mutationMock.mockRejectedValueOnce(
      new Error("API token is missing required scope: meetings:finalize"),
    );

    const response = await reopenMeeting(
      new Request("https://localhost/api/v1/meetings/research-sync/reopen", {
        method: "POST",
        headers: { authorization: "Bearer ms_api_raw-secret" },
      }),
      { params: Promise.resolve({ slug: "research-sync" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("insufficient_scope");
  });

  it("requires a verified email session before token creation", async () => {
    verifySessionMock.mockReturnValueOnce(null);

    const response = await createToken(
      new NextRequest("https://localhost/api/v1/tokens", {
        method: "POST",
        body: JSON.stringify({ scopes: ["meetings:create"] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("email_session_required");
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("keeps token-session configuration failures inside the API error envelope", async () => {
    getIdentitySessionSecretMock.mockImplementationOnce(() => {
      throw new Error("MEETING_SCHEDULER_IDENTITY_SESSION_SECRET is required");
    });

    const response = await createToken(
      new NextRequest("https://localhost/api/v1/tokens", {
        method: "POST",
        body: JSON.stringify({ scopes: ["meetings:create"] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "internal_error",
        message: "The API request could not be completed.",
      },
    });
  });

  it("creates API tokens for verified email sessions and returns the raw token once", async () => {
    verifySessionMock.mockReturnValueOnce({
      emailIdentityId: "email-1",
      issuedAt: 1,
      expiresAt: 2,
    });
    mutationMock.mockResolvedValueOnce({
      apiToken: "ms_api_returned-once",
      tokenFingerprint: "fingerprint-1",
      scopes: ["meetings:create"],
      createdAt: 123,
    });

    const response = await createToken(
      new NextRequest("https://localhost/api/v1/tokens", {
        method: "POST",
        headers: { cookie: "ms_email_session=session-token" },
        body: JSON.stringify({ scopes: ["meetings:create"] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.apiToken).toBe("ms_api_returned-once");
    expect(mutationMock).toHaveBeenCalledWith(
      "agentApi:createApiToken",
      expect.objectContaining({
        internalSecret: "internal-secret",
        emailIdentityId: "email-1",
        scopes: ["meetings:create"],
      }),
    );
  });

  it("revokes only tokens owned by the verified email session", async () => {
    verifySessionMock.mockReturnValueOnce({
      emailIdentityId: "email-1",
      issuedAt: 1,
      expiresAt: 2,
    });
    mutationMock.mockResolvedValueOnce({
      tokenFingerprint: "fingerprint-1",
      revokedAt: 123,
    });

    const response = await revokeToken(
      new NextRequest("https://localhost/api/v1/tokens/fingerprint-1", {
        method: "DELETE",
        headers: { cookie: "ms_email_session=session-token" },
      }),
      { params: Promise.resolve({ tokenFingerprint: "fingerprint-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      tokenFingerprint: "fingerprint-1",
      revokedAt: 123,
    });
    expect(JSON.stringify(body)).not.toContain("ms_api_");
    expect(mutationMock).toHaveBeenCalledWith(
      "agentApi:revokeApiToken",
      expect.objectContaining({
        emailIdentityId: "email-1",
        tokenFingerprint: "fingerprint-1",
      }),
    );
  });

  it("keeps token-revoke session configuration failures inside the API error envelope", async () => {
    getIdentitySessionSecretMock.mockImplementationOnce(() => {
      throw new Error("MEETING_SCHEDULER_IDENTITY_SESSION_SECRET is required");
    });

    const response = await revokeToken(
      new NextRequest("https://localhost/api/v1/tokens/fingerprint-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ tokenFingerprint: "fingerprint-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(mutationMock).not.toHaveBeenCalled();
  });
});
