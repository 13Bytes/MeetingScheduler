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
