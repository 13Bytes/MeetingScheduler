import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/app-shell";

describe("AppShell", () => {
  it("provides a compact mobile menu alongside the logo and desktop navigation", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: /meeting scheduler/i })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByText(/open navigation menu/i)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /^primary$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: /mobile primary/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /new meeting/i })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /all meetings/i })).toHaveLength(2);
  });
});
