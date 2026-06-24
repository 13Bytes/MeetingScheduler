export const meetingLifecycleStates = ["open", "finalized"] as const;
export type MeetingLifecycleState = (typeof meetingLifecycleStates)[number];

export const membershipRoles = ["admin", "member"] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export const adminModes = ["roleBased", "everyoneAdmin"] as const;
export type AdminMode = (typeof adminModes)[number];

export const privacyModes = ["detailed", "summaryOnly"] as const;
export type PrivacyMode = (typeof privacyModes)[number];

export const availabilityResponses = ["yes", "reluctant", "no"] as const;
export type AvailabilityResponse = (typeof availabilityResponses)[number];

export const DEFAULT_GRANULARITY_MINUTES = 30;
export const DEFAULT_DURATION_MINUTES = 60;
export const DEFAULT_TIME_ZONE = "UTC";

export type MeetingSettingsInput = {
  canonicalTimeZone?: string;
  granularityMinutes?: number;
  durationMinutes?: number;
  allowedTimeRanges?: AllowedTimeRangeInput[];
};

export type AllowedTimeRangeInput = {
  startUtc: string;
  endUtc: string;
  timeZone?: string;
  label?: string;
};

export type AllowedTimeRange = {
  startUtc: string;
  endUtc: string;
  timeZone: string;
  label?: string;
};

export type SlotInput = {
  startUtc: string;
  endUtc: string;
  timeZone?: string;
};

export type Slot = {
  startUtc: string;
  endUtc: string;
  timeZone: string;
};

export type MeetingSettings = {
  canonicalTimeZone: string;
  granularityMinutes: number;
  durationMinutes: number;
  allowedTimeRanges: AllowedTimeRange[];
};

export type PermissionMeeting = {
  adminMode: AdminMode;
  lifecycleState: MeetingLifecycleState;
};

export type PermissionMembership = {
  role: MembershipRole;
  revokedAt?: number;
} | null;

export type MembershipCapabilities = {
  canAdminister: boolean;
  canEditAvailability: boolean;
  canFinalize: boolean;
  canReopen: boolean;
  canReadDetailedAvailability: boolean;
};

export function normalizeMeetingSettings(
  input: MeetingSettingsInput = {},
): MeetingSettings {
  const canonicalTimeZone = input.canonicalTimeZone ?? DEFAULT_TIME_ZONE;
  assertIanaTimeZone(canonicalTimeZone);

  const granularityMinutes = input.granularityMinutes ?? DEFAULT_GRANULARITY_MINUTES;
  assertPositiveInteger("granularityMinutes", granularityMinutes);
  if (granularityMinutes < 5 || granularityMinutes > 240) {
    throw new Error("granularityMinutes must be between 5 and 240 minutes");
  }

  const durationMinutes = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  assertPositiveInteger("durationMinutes", durationMinutes);
  if (durationMinutes < 5 || durationMinutes > 24 * 60) {
    throw new Error("durationMinutes must be between 5 minutes and 24 hours");
  }
  if (durationMinutes % granularityMinutes !== 0) {
    throw new Error("durationMinutes must be a multiple of granularityMinutes");
  }

  const allowedTimeRanges = (input.allowedTimeRanges ?? []).map((range) =>
    normalizeAllowedTimeRange(range, canonicalTimeZone),
  );

  return {
    canonicalTimeZone,
    granularityMinutes,
    durationMinutes,
    allowedTimeRanges,
  };
}

export function normalizeAllowedTimeRange(
  input: AllowedTimeRangeInput,
  canonicalTimeZone: string,
): AllowedTimeRange {
  const timeZone = input.timeZone ?? canonicalTimeZone;
  assertIanaTimeZone(timeZone);

  const startUtc = normalizeIsoInstant("startUtc", input.startUtc);
  const endUtc = normalizeIsoInstant("endUtc", input.endUtc);
  if (Date.parse(endUtc) <= Date.parse(startUtc)) {
    throw new Error("allowed time range endUtc must be after startUtc");
  }

  return {
    startUtc,
    endUtc,
    timeZone,
    ...(input.label ? { label: input.label } : {}),
  };
}

export function getMembershipCapabilities(
  meeting: PermissionMeeting,
  membership: PermissionMembership,
): MembershipCapabilities {
  const isActiveMember = Boolean(membership && membership.revokedAt === undefined);
  const canAdminister = Boolean(
    isActiveMember &&
    (membership?.role === "admin" || meeting.adminMode === "everyoneAdmin"),
  );
  const isOpen = meeting.lifecycleState === "open";

  return {
    canAdminister,
    canEditAvailability: isActiveMember && isOpen,
    canFinalize: canAdminister && isOpen,
    canReopen: canAdminister && meeting.lifecycleState === "finalized",
    canReadDetailedAvailability: isActiveMember,
  };
}

export function assertCanAdminister(
  meeting: PermissionMeeting,
  membership: PermissionMembership,
): void {
  if (!getMembershipCapabilities(meeting, membership).canAdminister) {
    throw new Error("Membership cannot administer this meeting");
  }
}

export function assertCanEditOpenMeeting(
  meeting: PermissionMeeting,
  membership: PermissionMembership,
): void {
  const capabilities = getMembershipCapabilities(meeting, membership);
  if (!capabilities.canAdminister) {
    throw new Error("Membership cannot administer this meeting");
  }
  if (meeting.lifecycleState !== "open") {
    throw new Error("Finalized meetings are read-only until reopened");
  }
}

export function transitionMeetingLifecycle(
  meeting: PermissionMeeting,
  membership: PermissionMembership,
  transition: "finalize" | "reopen",
): MeetingLifecycleState {
  const capabilities = getMembershipCapabilities(meeting, membership);
  if (transition === "finalize") {
    if (!capabilities.canFinalize) {
      throw new Error("Only an active admin can finalize an open meeting");
    }
    return "finalized";
  }

  if (!capabilities.canReopen) {
    throw new Error("Only an active admin can reopen a finalized meeting");
  }
  return "open";
}

export function makeAvailabilityCellKey(startUtc: string, endUtc: string): string {
  return `${normalizeIsoInstant("startUtc", startUtc)}_${normalizeIsoInstant(
    "endUtc",
    endUtc,
  )}`;
}

export function assertAvailabilityCellAlignment(
  startUtc: string,
  endUtc: string,
  granularityMinutes: number,
  timeZone = DEFAULT_TIME_ZONE,
): void {
  assertIanaTimeZone(timeZone);

  const normalizedStartUtc = normalizeIsoInstant("startUtc", startUtc);
  const normalizedEndUtc = normalizeIsoInstant("endUtc", endUtc);
  const startMs = Date.parse(normalizedStartUtc);
  const endMs = Date.parse(normalizedEndUtc);
  const granularityMs = granularityMinutes * 60 * 1000;

  if (endMs <= startMs) {
    throw new Error("Availability cell endUtc must be after startUtc");
  }
  if ((endMs - startMs) % granularityMs !== 0) {
    throw new Error("Availability cell must align to the meeting granularity");
  }

  const startParts = getZonedTimeParts(normalizedStartUtc, timeZone);
  const endParts = getZonedTimeParts(normalizedEndUtc, timeZone);
  if (
    !isOnLocalGridBoundary(startParts, granularityMinutes) ||
    !isOnLocalGridBoundary(endParts, granularityMinutes)
  ) {
    throw new Error("Availability cell boundaries must align to the meeting grid");
  }
}

export function normalizeFinalizedSlot(
  input: SlotInput,
  meeting: {
    canonicalTimeZone: string;
    durationMinutes: number;
    granularityMinutes: number;
    allowedTimeRanges: AllowedTimeRange[];
  },
): Slot {
  const slot = normalizeAllowedTimeRange(input, meeting.canonicalTimeZone);
  assertAvailabilityCellAlignment(
    slot.startUtc,
    slot.endUtc,
    meeting.granularityMinutes,
    slot.timeZone,
  );

  const durationMs = Date.parse(slot.endUtc) - Date.parse(slot.startUtc);
  if (durationMs !== meeting.durationMinutes * 60 * 1000) {
    throw new Error("Finalized slot must match the meeting duration");
  }

  if (!isSlotInsideAllowedRanges(slot, meeting.allowedTimeRanges)) {
    throw new Error("Finalized slot must be inside an allowed time range");
  }

  return {
    startUtc: slot.startUtc,
    endUtc: slot.endUtc,
    timeZone: slot.timeZone,
  };
}

export function isSlotInsideAllowedRanges(
  slot: SlotInput,
  allowedTimeRanges: AllowedTimeRange[],
): boolean {
  if (allowedTimeRanges.length === 0) {
    return true;
  }

  const startMs = Date.parse(normalizeIsoInstant("startUtc", slot.startUtc));
  const endMs = Date.parse(normalizeIsoInstant("endUtc", slot.endUtc));

  return allowedTimeRanges.some((range) => {
    const rangeStartMs = Date.parse(range.startUtc);
    const rangeEndMs = Date.parse(range.endUtc);
    return startMs >= rangeStartMs && endMs <= rangeEndMs;
  });
}

export function slugifyMeetingTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "meeting";
}

export function normalizeEmailAddress(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error("Email address must be valid");
  }
  return normalized;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertIanaTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

export function normalizeIsoInstant(name: string, value: string): string {
  if (!/(?:z|[+-]\d{2}:\d{2})$/iu.test(value.trim())) {
    throw new Error(`${name} must include an explicit timezone offset`);
  }

  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`${name} must be a valid ISO instant`);
  }
  return new Date(time).toISOString();
}

function getZonedTimeParts(
  isoInstant: string,
  timeZone: string,
): {
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(isoInstant));

  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number(valueByType.get("hour")),
    minute: Number(valueByType.get("minute")),
    second: Number(valueByType.get("second")),
  };
}

function isOnLocalGridBoundary(
  parts: { hour: number; minute: number; second: number },
  granularityMinutes: number,
): boolean {
  const minuteOfDay = parts.hour * 60 + parts.minute;
  return parts.second === 0 && minuteOfDay % granularityMinutes === 0;
}
