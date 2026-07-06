const secretPatterns = [
  /\bms_(?:api|magic|member)_[A-Za-z0-9_-]+\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu,
  /\bsk-[A-Za-z0-9_-]+\b/gu,
  /\bsha256:[A-Za-z0-9_-]+\b/gu,
];

export function redactSecrets(value: string): string {
  return secretPatterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, "[redacted-secret]"),
    value,
  );
}

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  return redactSecrets(error.message).slice(0, 500) || fallback;
}
