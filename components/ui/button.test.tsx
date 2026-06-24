import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders children with button semantics", () => {
    render(<Button>Schedule</Button>);

    expect(screen.getByRole("button", { name: "Schedule" })).toBeInTheDocument();
  });
});
