export const notificationDeliveryLeaseMs = 15 * 60 * 1000;
export const maxNotificationAttempts = 5;

export function getNotificationRetryAt(args: {
  attempts: number;
  now: number;
}): number | undefined {
  if (args.attempts >= maxNotificationAttempts) {
    return undefined;
  }
  const delay = Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, args.attempts - 1));
  return args.now + delay;
}

export function normalizeDeliveryError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (extractObjectErrorMessage(error) ?? "Email delivery failed");
  return message.slice(0, 500);
}

function extractObjectErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const maybeMessage = "message" in error ? error.message : undefined;
  if (typeof maybeMessage === "string") {
    return maybeMessage;
  }
  const maybeError = "error" in error ? error.error : undefined;
  if (typeof maybeError === "string") {
    return maybeError;
  }
  return undefined;
}
