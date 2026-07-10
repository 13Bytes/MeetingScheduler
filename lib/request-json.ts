export const maxJsonRequestBytes = 256 * 1024;

export async function readBoundedJsonObject<T extends object>(
  request: Request,
): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxJsonRequestBytes) {
    throw new Error("Request body is too large");
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxJsonRequestBytes) {
    throw new Error("Request body is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as T;
}
