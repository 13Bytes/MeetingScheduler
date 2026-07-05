import { describe, expect, it } from "vitest";
import { apiErrorResponseForMessage } from "./responses";

describe("agent API error responses", () => {
  it("maps duplicate resources to conflict without leaking raw wording", async () => {
    const response = apiErrorResponseForMessage(
      "A meeting with this slug already exists",
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "conflict",
        message: "The requested resource already exists.",
      },
    });
  });

  it("maps unclassified failures to a generic internal error", async () => {
    const response = apiErrorResponseForMessage("database exploded with secret detail");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "internal_error",
        message: "The API request could not be completed.",
      },
    });
  });
});
