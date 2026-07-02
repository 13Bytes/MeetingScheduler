import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexUrl } from "@/lib/identity-internal";

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
    const result = await convex.mutation(api.meetings.requestEmailVerification, {
      email: body.email,
      displayName: body.displayName,
    });
    const origin = new URL(request.url).origin;
    const devMagicLinkUrl = result.devMagicLinkToken
      ? new URL(
          `/identity/verify?token=${encodeURIComponent(result.devMagicLinkToken)}`,
          origin,
        ).toString()
      : undefined;

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
