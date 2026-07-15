import { buildAbsoluteAppUrl, routes } from "@/lib/routes";
import { getConfiguredEmailFrom, type EmailMessage } from "./adapter";

export type PasswordlessEmailPurpose = "emailVerification" | "membershipRecovery";

export function renderPasswordlessEmail(args: {
  purpose: PasswordlessEmailPurpose;
  to: string;
  magicLinkUrl: string;
  expiresAt: number;
  from?: string;
}): EmailMessage {
  const isRecovery = args.purpose === "membershipRecovery";
  const title = isRecovery
    ? "Recover your Meeting Scheduler link"
    : "Verify your email for Meeting Scheduler";
  const action = isRecovery ? "recover your meeting link" : "verify your email";
  const expiry = formatDateTime(args.expiresAt);
  const text = [
    title,
    "",
    `Use this link to ${action}:`,
    args.magicLinkUrl,
    "",
    `This link expires ${expiry}. If you did not request it, you can ignore this email.`,
  ].join("\n");

  return {
    to: args.to,
    from: args.from ?? getConfiguredEmailFrom(),
    subject: title,
    text,
    html: [
      `<p>Use this link to ${escapeHtml(action)}:</p>`,
      `<p><a href="${escapeHtml(args.magicLinkUrl)}">${escapeHtml(title)}</a></p>`,
      `<p>This link expires ${escapeHtml(expiry)}. If you did not request it, you can ignore this email.</p>`,
    ].join(""),
  };
}

export function renderMeetingLifecycleEmail(args: {
  kind: "meeting.finalized" | "meeting.reopened";
  to: string;
  meetingTitle: string;
  meetingUrl: string;
  dashboardUrl: string;
  finalizedSlot?: {
    startUtc: string;
    endUtc: string;
    timeZone?: string;
  };
  from?: string;
}): EmailMessage {
  const isFinalized = args.kind === "meeting.finalized";
  const subject = isFinalized
    ? `Final time selected: ${args.meetingTitle}`
    : `Meeting reopened: ${args.meetingTitle}`;
  const slotText =
    isFinalized && args.finalizedSlot
      ? `Selected time: ${formatSlot(args.finalizedSlot)}`
      : undefined;
  const lead = isFinalized
    ? "An admin finalized this poll."
    : "An admin reopened this poll for more edits.";
  const text = [
    subject,
    "",
    lead,
    ...(slotText ? [slotText] : []),
    "",
    `Open meeting: ${args.meetingUrl}`,
    `View all meetings: ${args.dashboardUrl}`,
  ].join("\n");

  return {
    to: args.to,
    from: args.from ?? getConfiguredEmailFrom(),
    subject,
    text,
    html: [
      `<p>${escapeHtml(lead)}</p>`,
      slotText ? `<p>${escapeHtml(slotText)}</p>` : "",
      `<p><a href="${escapeHtml(args.meetingUrl)}">Open meeting</a></p>`,
      `<p><a href="${escapeHtml(args.dashboardUrl)}">View all meetings</a></p>`,
    ].join(""),
  };
}

export function buildLifecycleEmailUrls(args: {
  appOrigin: string;
  meetingSlug: string;
}) {
  return {
    meetingUrl: buildAbsoluteAppUrl(routes.meetingPoll(args.meetingSlug), args.appOrigin),
    dashboardUrl: buildAbsoluteAppUrl(routes.identityDashboard, args.appOrigin),
  };
}

function formatSlot(slot: {
  startUtc: string;
  endUtc: string;
  timeZone?: string;
}): string {
  const timeZone = slot.timeZone || "UTC";
  return `${formatDateTime(Date.parse(slot.startUtc), timeZone)} - ${formatDateTime(
    Date.parse(slot.endUtc),
    timeZone,
  )}`;
}

function formatDateTime(value: number, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;");
}
