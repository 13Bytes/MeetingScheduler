import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { createEmailDeliveryAdapter, getConfiguredEmailFrom } from "@/lib/email/adapter";
import { normalizeDeliveryError } from "@/lib/email/outbox";
import { renderPasswordlessEmail } from "@/lib/email/templates";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      displayName?: string;
    };
    if (!body.email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

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
    const origin = getAppOrigin(request);
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

    try {
      const delivery = await adapter.send(
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
      await convex.mutation(api.meetings.markNotificationSent, {
        internalSecret: getInternalIdentitySecret(),
        notificationId: result.notificationOutboxId,
        provider: delivery.provider,
        providerMessageId: delivery.providerMessageId,
      });
    } catch (deliveryError) {
      await convex.mutation(api.meetings.markNotificationFailed, {
        internalSecret: getInternalIdentitySecret(),
        notificationId: result.notificationOutboxId,
        error: normalizeDeliveryError(deliveryError),
      });
      throw deliveryError;
    }

    return NextResponse.json({
      deliveryQueued: result.deliveryQueued,
      tokenFingerprint: result.tokenFingerprint,
      expiresAt: result.expiresAt,
      devMagicLinkUrl,
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to request an email verification link.",
      },
      { status: 400 },
    );
  }
}

function getAppOrigin(request: Request): string {
  return process.env.MEETING_SCHEDULER_APP_URL ?? new URL(request.url).origin;
}
