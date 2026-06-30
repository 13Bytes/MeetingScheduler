import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParticipantAvailabilityPainter } from "@/components/participant-availability-painter";

const meeting = {
  title: "Stage 4 planning",
  slug: "stage-4-planning",
  lifecycleState: "open" as const,
  adminMode: "roleBased" as const,
  canonicalTimeZone: "Europe/Berlin",
  granularityMinutes: 30,
  durationMinutes: 60,
  allowedTimeRanges: [
    {
      startUtc: "2026-06-25T07:00:00.000Z",
      endUtc: "2026-06-25T09:00:00.000Z",
      timeZone: "Europe/Berlin",
    },
  ],
};

const baseData = {
  meeting,
  capabilities: {
    canAdminister: false,
    canEditAvailability: true,
  },
  ownAvailabilityRecords: [],
};

describe("ParticipantAvailabilityPainter", () => {
  it("requires a display name before creating a public-link membership", async () => {
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={vi.fn()}
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /join and save/i }));

    expect(
      await screen.findByText(/enter your display name before saving availability/i),
    ).toBeInTheDocument();
  });

  it("creates a membership before the first persisted availability write", async () => {
    const onCreateMembership = vi
      .fn()
      .mockResolvedValue({ membershipToken: "member-secret-token" });
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={onCreateMembership}
        onSaveAvailability={onSaveAvailability}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 unset/i }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: /join and save/i }));

    await waitFor(() => expect(onCreateMembership).toHaveBeenCalledWith("Ada Lovelace"));
    await waitFor(() =>
      expect(onSaveAvailability).toHaveBeenCalledWith("member-secret-token", [
        {
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T07:30:00.000Z",
          timeZone: "Europe/Berlin",
          response: "yes",
        },
      ]),
    );
    expect(
      (
        await screen.findByRole("textbox", { name: /^personal membership link$/i })
      ).getAttribute("value"),
    ).toContain("/join/member-secret-token");
  });

  it("shows a joined notice when saving a public membership without painted cells", async () => {
    const onCreateMembership = vi
      .fn()
      .mockResolvedValue({ membershipToken: "member-secret-token" });
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={onCreateMembership}
        onSaveAvailability={onSaveAvailability}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join and save/i }));

    expect(await screen.findByText(/joined meeting/i)).toBeInTheDocument();
    expect(onSaveAvailability).not.toHaveBeenCalled();
  });

  it("does not clobber unsaved paint edits when membership data refreshes", () => {
    const { rerender } = render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 unset/i }), {
      key: "Enter",
    });
    expect(
      screen.getByRole("gridcell", { name: /thu jun 25 09:00 yes/i }),
    ).toBeInTheDocument();

    rerender(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
          ownAvailabilityRecords: [
            {
              cellKey: "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
              startUtc: "2026-06-25T07:30:00.000Z",
              endUtc: "2026-06-25T08:00:00.000Z",
              timeZone: "Europe/Berlin",
              response: "no",
            },
          ],
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    expect(
      screen.getByRole("gridcell", { name: /thu jun 25 09:00 yes/i }),
    ).toBeInTheDocument();
  });

  it("lets returning members clear their own persisted response", async () => {
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    const cellKey = "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z";
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
          ownAvailabilityRecords: [
            {
              cellKey,
              startUtc: "2026-06-25T07:00:00.000Z",
              endUtc: "2026-06-25T07:30:00.000Z",
              timeZone: "Europe/Berlin",
              response: "yes",
            },
          ],
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={onSaveAvailability}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 yes/i }), {
      key: " ",
    });
    fireEvent.click(screen.getByRole("button", { name: /save response/i }));

    await waitFor(() =>
      expect(onSaveAvailability).toHaveBeenCalledWith("member-secret-token", [
        {
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T07:30:00.000Z",
          timeZone: "Europe/Berlin",
        },
      ]),
    );
  });

  it("updates a nameless existing membership before saving availability", async () => {
    const onUpdateDisplayName = vi.fn().mockResolvedValue(undefined);
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "admin" },
        }}
        existingMembershipToken="admin-secret-token"
        onUpdateDisplayName={onUpdateDisplayName}
        onSaveAvailability={onSaveAvailability}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 unset/i }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: /save response/i }));

    await waitFor(() =>
      expect(onUpdateDisplayName).toHaveBeenCalledWith(
        "admin-secret-token",
        "Grace Hopper",
      ),
    );
    expect(onSaveAvailability).toHaveBeenCalledWith("admin-secret-token", [
      expect.objectContaining({ response: "yes" }),
    ]);
  });

  it("keeps finalized meetings read-only", () => {
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          meeting: { ...meeting, lifecycleState: "finalized" },
          capabilities: { canAdminister: false, canEditAvailability: false },
        }}
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    expect(screen.getByText(/finalized meeting/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join and save/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^yes$/i })).toBeDisabled();
  });
});
