import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { createEmailDeliveryAdapter, getConfiguredEmailFrom } from "@/lib/email/adapter";
import { getNotificationRetryAt, normalizeDeliveryError } from "@/lib/email/outbox";
import {
  buildLifecycleEmailUrls,
  renderMeetingLifecycleEmail,
} from "@/lib/email/templates";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";

export async function POST(request: NextRequest) {
  const unauthorized = authorizeProcessor(request);
  if (unauthorized) {
    return unauthorized;
  }

  const convex = new ConvexHttpClient(getConvexUrl());
  const internalSecret = getInternalIdentitySecret();
  const adapter = createEmailDeliveryAdapter();
  const now = Date.now();
  const limit = parseProcessorLimit(request.nextUrl.searchParams.get("limit"));
  const appOrigin = getAppOrigin(request);
  const candidates = await convex.query(api.meetings.listQueuedEmailNotifications, {
    internalSecret,
    now,
    limit,
  });
  const results = [];

  for (const notificationId of candidates.notificationIds) {
    const claim = await convex.mutation(api.meetings.claimNotificationForDelivery, {
      internalSecret,
      notificationId,
      now: Date.now(),
    });
    if (claim.status !== "claimed") {
      results.push({ notificationId, status: claim.status });
      continue;
    }

    if (!isLifecycleNotificationKind(claim.notification.kind)) {
      results.push({ notificationId, status: "skipped" });
      continue;
    }
    const { meetingUrl, dashboardUrl } = buildLifecycleEmailUrls({
      appOrigin,
      meetingSlug: claim.meeting.slug,
    });
    let delivery;
    try {
      const message = renderMeetingLifecycleEmail({
        kind: claim.notification.kind,
        to: claim.recipient.normalizedEmail,
        from: getConfiguredEmailFrom(),
        meetingTitle: claim.meeting.title,
        meetingUrl,
        dashboardUrl,
        finalizedSlot: getFinalizedSlotForEmail(claim.notification),
      });
      delivery = await adapter.send(message, {
        idempotencyKey:
          claim.notification.dedupeKey ?? `notification:${claim.notification._id}`,
      });
    } catch (caughtError) {
      const retryAt = getNotificationRetryAt({
        attempts: claim.notification.attempts,
        now: Date.now(),
      });
      await convex.mutation(api.meetings.markNotificationFailed, {
        internalSecret,
        notificationId: claim.notification._id,
        error: normalizeDeliveryError(caughtError),
        retryAt,
      });
      results.push({ notificationId, status: "failed", retryAt });
      continue;
    }

    await convex.mutation(api.meetings.markNotificationSent, {
      internalSecret,
      notificationId: claim.notification._id,
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
    });
    results.push({ notificationId, status: "sent" });
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

function authorizeProcessor(request: NextRequest) {
  const expectedSecret = process.env.MEETING_SCHEDULER_NOTIFICATION_PROCESS_SECRET;
  if (!expectedSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "MEETING_SCHEDULER_NOTIFICATION_PROCESS_SECRET is required." },
        { status: 500 },
      );
    }
    return null;
  }

  const providedSecret = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/iu, "");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

function getAppOrigin(request: NextRequest): string {
  const configuredOrigin = process.env.MEETING_SCHEDULER_APP_URL;
  if (configuredOrigin) {
    return new URL(configuredOrigin).origin;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MEETING_SCHEDULER_APP_URL is required");
  }
  return new URL(request.url).origin;
}

function parseProcessorLimit(value: string | null): number {
  const parsed = Number(value ?? "20");
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return parsed;
}

function isLifecycleNotificationKind(
  kind: string,
): kind is "meeting.finalized" | "meeting.reopened" {
  return kind === "meeting.finalized" || kind === "meeting.reopened";
}

function getFinalizedSlotForEmail(notification: {
  kind: string;
  payload: Record<string, string | number | boolean | null>;
}) {
  if (notification.kind !== "meeting.finalized") {
    return undefined;
  }
  const { startUtc, endUtc, timeZone } = notification.payload;
  if (typeof startUtc !== "string" || typeof endUtc !== "string") {
    return undefined;
  }
  return {
    startUtc,
    endUtc,
    timeZone: typeof timeZone === "string" ? timeZone : undefined,
  };
}
