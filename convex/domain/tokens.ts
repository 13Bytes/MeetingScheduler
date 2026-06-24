export const TOKEN_RANDOM_BYTES = 32;

export type SecretTokenKind = "membership" | "magicLink";

const TOKEN_PREFIXES: Record<SecretTokenKind, string> = {
  membership: "ms_member",
  magicLink: "ms_magic",
};

const TOKEN_HASH_CONTEXT = "meeting-scheduler-stage-1";

export type SecretTokenMaterial = {
  rawToken: string;
  tokenHash: string;
  tokenFingerprint: string;
};

export async function createSecretToken(
  kind: SecretTokenKind,
): Promise<SecretTokenMaterial> {
  const bytes = new Uint8Array(TOKEN_RANDOM_BYTES);
  globalThis.crypto.getRandomValues(bytes);

  const rawToken = `${TOKEN_PREFIXES[kind]}_${bytesToBase64Url(bytes)}`;
  const tokenHash = await hashSecretToken(rawToken);

  return {
    rawToken,
    tokenHash,
    tokenFingerprint: tokenFingerprintFromHash(tokenHash),
  };
}

export async function hashSecretToken(rawToken: string): Promise<string> {
  const normalizedToken = rawToken.trim();
  if (!normalizedToken) {
    throw new Error("Secret token cannot be blank");
  }

  const payload = new TextEncoder().encode(`${TOKEN_HASH_CONTEXT}:${normalizedToken}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  return `sha256:${bytesToBase64Url(new Uint8Array(digest))}`;
}

export function tokenFingerprintFromHash(tokenHash: string): string {
  const [, digest] = tokenHash.split(":");
  if (!digest) {
    throw new Error("Token hash must include an algorithm prefix");
  }
  return digest.slice(0, 16);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;

    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[triplet & 63] : "=";
  }

  return output.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
