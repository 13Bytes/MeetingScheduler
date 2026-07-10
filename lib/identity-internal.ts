export const devInternalIdentitySecret =
  "dev-only-meeting-scheduler-identity-internal-secret";

type IdentityEnv = {
  MEETING_SCHEDULER_ALLOW_DEV_IDENTITY_SECRET?: string;
  MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET?: string;
  NEXT_PUBLIC_CONVEX_URL?: string;
  NODE_ENV?: string;
};

export function getInternalIdentitySecret(env: IdentityEnv = process.env): string {
  const configuredSecret = env.MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET;
  if (configuredSecret) {
    if (configuredSecret.length < 32) {
      throw new Error(
        "MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET must be at least 32 characters",
      );
    }
    return configuredSecret;
  }
  if (env.NODE_ENV === "production") {
    throw new Error("MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET is required");
  }
  if (env.MEETING_SCHEDULER_ALLOW_DEV_IDENTITY_SECRET !== "true") {
    throw new Error("MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET is required");
  }
  return devInternalIdentitySecret;
}

export function getConvexUrl(env: IdentityEnv = process.env): string {
  const convexUrl = env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  }
  return convexUrl;
}
