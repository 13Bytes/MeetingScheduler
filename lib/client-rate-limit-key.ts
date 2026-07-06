"use client";

const storageKey = "meeting-scheduler:anonymous-rate-limit-key:v1";
let ephemeralKey: string | undefined;

export function getAnonymousClientRateLimitKey(): string {
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      return existing;
    }
    const nextKey = createClientKey();
    window.localStorage.setItem(storageKey, nextKey);
    return nextKey;
  } catch {
    ephemeralKey ??= createClientKey();
    return ephemeralKey;
  }
}

function createClientKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
