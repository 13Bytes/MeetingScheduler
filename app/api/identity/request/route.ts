import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { createEmailDeliveryAdapter, getConfiguredEmailFrom } from "@/lib/email/adapter";
import { normalizeDeliveryError } from "@/lib/email/outbox";
import { renderPasswordlessEmail } from "@/lib/email/templates";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  enforceRequestRateLimit,
  getClientIp,
  hashRateLimitKey,
  RateLimitError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/security-redaction";
import { readBoundedJsonObject } from "@/lib/request-json";

export async function POST(request: Request) {
  try {
    await enforceRequestRateLimit({
      request,
      scope: "identity.request.ip",
      key: getClientIp(request),
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    const body = await readBoundedJsonObject<{
      email?: string;
      displayName?: string;
    }>(request);
    if (!body.email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    await enforceRequestRateLimit({
      request,
      scope: "identity.request.email",
      key: await hashRateLimitKey(body.email),
      limit: 3,
      windowMs: 15 * 60 * 1000,
    });

    const origin = getAppOrigin(request);
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(
      api.meetings.requestEmailVerificationForDelivery,
      {
        internalSecret: getInternalIdentitySecret(),
        email: body.email,
        displayName: body.displayName,
      },
    );
    if (!result.rawMagicLinkToken) {
      throw new Error("Unable to prepare verification email.");
    }
    const magicLinkUrl = new URL(
      `/identity/verify?token=${encodeURIComponent(result.rawMagicLinkToken)}`,
      origin,
    ).toString();
    const devMagicLinkUrl = result.devMagicLinkToken
      ? new URL(
          `/identity/verify?token=${encodeURIComponent(result.devMagicLinkToken)}`,
          origin,
        ).toString()
      : undefined;
    const adapter = createEmailDeliveryAdapter();

    let delivery;
    try {
      delivery = await adapter.send(
        renderPasswordlessEmail({
          purpose: "emailVerification",
          to: result.normalizedEmail,
          from: getConfiguredEmailFrom(),
          magicLinkUrl,
          expiresAt: result.expiresAt,
        }),
        {
          idempotencyKey: `notification:${result.notificationOutboxId}:${result.tokenFingerprint}`,
        },
      );
    } catch (deliveryError) {
      await convex.mutation(api.meetings.markNotificationFailed, {
        internalSecret: getInternalIdentitySecret(),
        notificationId: result.notificationOutboxId,
        error: normalizeDeliveryError(deliveryError),
      });
      throw deliveryError;
    }
    try {
      await convex.mutation(api.meetings.markNotificationSent, {
        internalSecret: getInternalIdentitySecret(),
        notificationId: result.notificationOutboxId,
        provider: delivery.provider,
        providerMessageId: delivery.providerMessageId,
      });
    } catch (statusError) {
      console.error(
        "Failed to mark verification email sent",
        safeErrorMessage(statusError, "status update failed"),
      );
    }

    return NextResponse.json({
      deliveryQueued: result.deliveryQueued,
      tokenFingerprint: result.tokenFingerprint,
      expiresAt: result.expiresAt,
      devMagicLinkUrl,
    });
  } catch (caughtError) {
    if (caughtError instanceof RateLimitError) {
      return rateLimitErrorResponse(caughtError);
    }
    return NextResponse.json(
      {
        error: safeErrorMessage(
          caughtError,
          "Unable to request an email verification link.",
        ),
      },
      { status: 400 },
    );
  }
}

function getAppOrigin(request: Request): string {
  const configuredOrigin = process.env.MEETING_SCHEDULER_APP_URL;
  if (configuredOrigin) {
    return new URL(configuredOrigin).origin;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MEETING_SCHEDULER_APP_URL is required");
  }
  return new URL(request.url).origin;
}
