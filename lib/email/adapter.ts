export type EmailMessage = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailDeliveryOptions = {
  idempotencyKey: string;
};

export type EmailDeliveryResult = {
  provider: "development" | "resend";
  providerMessageId: string;
  duplicate?: boolean;
};

export type EmailDeliveryAdapter = {
  provider: EmailDeliveryResult["provider"];
  send: (
    message: EmailMessage,
    options: EmailDeliveryOptions,
  ) => Promise<EmailDeliveryResult>;
};

type EmailEnv = {
  EMAIL_FROM?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  MEETING_SCHEDULER_EMAIL_DEV_LOG_CONTENT?: string;
  MEETING_SCHEDULER_EMAIL_PROVIDER?: string;
  NODE_ENV?: string;
  RESEND_API_KEY?: string;
};

type FetchLike = typeof fetch;

export const defaultDevelopmentEmailFrom = "Meeting Scheduler <dev@example.invalid>";
const resendRequestTimeoutMs = 10_000;

const localDeliveries: (EmailMessage & {
  idempotencyKey: string;
  providerMessageId: string;
})[] = [];
const localDeliveryIdsByKey = new Map<string, string>();

export function createEmailDeliveryAdapter(
  env: EmailEnv = process.env,
  fetchImpl: FetchLike = fetch,
): EmailDeliveryAdapter {
  const provider = env.MEETING_SCHEDULER_EMAIL_PROVIDER?.trim().toLowerCase();
  if (!provider && env.NODE_ENV === "production") {
    return createResendAdapter(env, fetchImpl);
  }
  if (!provider || provider === "development" || provider === "local") {
    return createDevelopmentAdapter(env);
  }
  if (provider === "resend") {
    return createResendAdapter(env, fetchImpl);
  }
  throw new Error(`Unsupported email provider "${provider}"`);
}

export function getConfiguredEmailFrom(env: EmailEnv = process.env): string {
  return env.EMAIL_FROM?.trim() || defaultDevelopmentEmailFrom;
}

export function getLocalDeliveredEmails() {
  return [...localDeliveries];
}

export function clearLocalDeliveredEmails() {
  localDeliveries.length = 0;
  localDeliveryIdsByKey.clear();
}

function createDevelopmentAdapter(env: EmailEnv): EmailDeliveryAdapter {
  return {
    provider: "development",
    async send(message, options) {
      const existingId = localDeliveryIdsByKey.get(options.idempotencyKey);
      if (existingId) {
        return {
          provider: "development",
          providerMessageId: existingId,
          duplicate: true,
        };
      }

      const providerMessageId = `dev_${hashIdempotencyKey(options.idempotencyKey)}`;
      localDeliveryIdsByKey.set(options.idempotencyKey, providerMessageId);
      localDeliveries.push({
        ...message,
        idempotencyKey: options.idempotencyKey,
        providerMessageId,
      });

      if (env.NODE_ENV !== "production") {
        console.info(
          `[meeting-scheduler email] queued local email ${providerMessageId} to ${message.to}: ${message.subject}`,
        );
        if (env.MEETING_SCHEDULER_EMAIL_DEV_LOG_CONTENT === "true") {
          console.info(message.text);
        }
      }

      return { provider: "development", providerMessageId };
    },
  };
}

function createResendAdapter(env: EmailEnv, fetchImpl: FetchLike): EmailDeliveryAdapter {
  const apiKey = env.RESEND_API_KEY || env.EMAIL_PROVIDER_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY or EMAIL_PROVIDER_API_KEY is required");
  }
  if (!from) {
    throw new Error("EMAIL_FROM is required");
  }

  return {
    provider: "resend",
    async send(message, options) {
      if (message.from !== from) {
        throw new Error("EmailMessage.from must match EMAIL_FROM for Resend delivery");
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), resendRequestTimeoutMs);
      let response: Response;
      try {
        response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": options.idempotencyKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            from: message.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("Resend email request timed out");
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };
      if (!response.ok || !body.id) {
        throw new Error(
          body.message || body.name || `Resend email request failed (${response.status})`,
        );
      }
      return { provider: "resend", providerMessageId: body.id };
    },
  };
}

function hashIdempotencyKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
