"use client";

const storagePrefix = "meeting-scheduler.membership-token.";
const cookiePrefix = "ms_membership_";
const maxAgeSeconds = 30 * 24 * 60 * 60;

export function readRememberedMembershipToken(meetingSlug: string): string | null {
  const storageKey = buildStorageKey(meetingSlug);
  try {
    const storedToken = window.localStorage.getItem(storageKey);
    if (storedToken) {
      return storedToken;
    }
  } catch {
    // Fall back to the cookie below.
  }

  return readCookie(buildCookieName(meetingSlug));
}

export function readRememberedMembershipTokens(): string[] {
  const tokens = new Set<string>();
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(storagePrefix)) {
        continue;
      }
      const token = window.localStorage.getItem(key)?.trim();
      if (token) {
        tokens.add(token);
      }
    }
  } catch {
    // Continue with cookie-backed tokens below.
  }

  for (const cookie of document.cookie.split("; ")) {
    if (!cookie.startsWith(cookiePrefix)) {
      continue;
    }
    const value = cookie.slice(cookie.indexOf("=") + 1).trim();
    if (value) {
      const decodedValue = safeDecodeURIComponent(value);
      if (decodedValue) {
        tokens.add(decodedValue);
      }
    }
  }

  return Array.from(tokens);
}

export function rememberMembershipToken(meetingSlug: string, membershipToken: string) {
  const trimmedToken = membershipToken.trim();
  if (!trimmedToken) {
    return;
  }

  try {
    window.localStorage.setItem(buildStorageKey(meetingSlug), trimmedToken);
  } catch {
    // The cookie still gives us a refresh-safe fallback when storage is unavailable.
    document.cookie = [
      `${buildCookieName(meetingSlug)}=${encodeURIComponent(trimmedToken)}`,
      "Path=/",
      `Max-Age=${maxAgeSeconds}`,
      "SameSite=Lax",
      ...(window.location.protocol === "https:" ? ["Secure"] : []),
    ].join("; ");
  }
}

export function forgetRememberedMembershipToken(meetingSlug: string) {
  try {
    window.localStorage.removeItem(buildStorageKey(meetingSlug));
  } catch {
    // Continue clearing the cookie.
  }

  document.cookie = `${buildCookieName(meetingSlug)}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function buildStorageKey(meetingSlug: string) {
  return `${storagePrefix}${meetingSlug}`;
}

function buildCookieName(meetingSlug: string) {
  return `${cookiePrefix}${encodeURIComponent(meetingSlug).replace(/%/g, "_")}`;
}

function readCookie(name: string): string | null {
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) {
    return null;
  }

  return decodeURIComponent(cookie.slice(name.length + 1));
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
