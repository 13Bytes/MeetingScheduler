import { createHmac, timingSafeEqual } from "node:crypto";

export const userSessionCookieName = "ms_user_session";
export const userSessionMaxAgeSeconds = 90 * 24 * 60 * 60;

export type UserSession = {
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

export function createUserSession(
  input: Omit<UserSession, "issuedAt" | "expiresAt"> & {
    now?: number;
    maxAgeSeconds?: number;
  },
  secret: string,
): string {
  assertUsableSessionSecret(secret);
  const issuedAt = input.now ?? Date.now();
  const expiresAt = issuedAt + (input.maxAgeSeconds ?? userSessionMaxAgeSeconds) * 1000;
  const payload: UserSession = {
    userId: input.userId,
    issuedAt,
    expiresAt,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signSessionPayload(encodedPayload, secret)}`;
}

export function verifyUserSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): UserSession | null {
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
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as UserSession;
    if (
      !parsed.userId ||
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

export function buildUserSessionCookie(
  token: string,
  {
    secure,
    maxAgeSeconds = userSessionMaxAgeSeconds,
  }: { secure: boolean; maxAgeSeconds?: number },
): string {
  return [
    `${userSessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function buildExpiredUserSessionCookie(): string {
  return [
    `${userSessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
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
