import { createHmac, timingSafeEqual } from "node:crypto";

export const identitySessionCookieName = "ms_email_session";
export const identitySessionMaxAgeSeconds = 30 * 24 * 60 * 60;

export type EmailIdentitySession = {
  emailIdentityId: string;
  normalizedEmail: string;
  issuedAt: number;
  expiresAt: number;
};

export function createEmailIdentitySession(
  input: Omit<EmailIdentitySession, "issuedAt" | "expiresAt"> & {
    now?: number;
    maxAgeSeconds?: number;
  },
  secret: string,
): string {
  assertUsableSessionSecret(secret);
  const issuedAt = input.now ?? Date.now();
  const expiresAt =
    issuedAt + (input.maxAgeSeconds ?? identitySessionMaxAgeSeconds) * 1000;
  const payload: EmailIdentitySession = {
    emailIdentityId: input.emailIdentityId,
    normalizedEmail: input.normalizedEmail,
    issuedAt,
    expiresAt,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signSessionPayload(encodedPayload, secret)}`;
}

export function verifyEmailIdentitySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): EmailIdentitySession | null {
  if (!token) {
    return null;
  }
  assertUsableSessionSecret(secret);
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }
  const expectedSignature = signSessionPayload(encodedPayload, secret);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as EmailIdentitySession;
    if (
      !parsed.emailIdentityId ||
      !parsed.normalizedEmail ||
      !Number.isFinite(parsed.issuedAt) ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildIdentitySessionCookie(
  token: string,
  {
    secure,
    maxAgeSeconds = identitySessionMaxAgeSeconds,
  }: { secure: boolean; maxAgeSeconds?: number },
): string {
  return [
    `${identitySessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function buildExpiredIdentitySessionCookie(): string {
  return [
    `${identitySessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function getIdentitySessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configuredSecret = env.MEETING_SCHEDULER_IDENTITY_SESSION_SECRET;
  if (configuredSecret) {
    return configuredSecret;
  }
  if (env.NODE_ENV === "production") {
    throw new Error("MEETING_SCHEDULER_IDENTITY_SESSION_SECRET is required");
  }
  return "dev-only-meeting-scheduler-identity-session-secret";
}

function assertUsableSessionSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error("Identity session secret must be at least 32 characters");
  }
}

function signSessionPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
