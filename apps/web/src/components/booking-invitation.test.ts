import { describe, expect, it } from "vitest";
import { bookingInvitationFromSearch } from "@/components/booking-invitation";

describe("Blockwise invitation booking propagation", () => {
  it("captures only the bounded invitation query value and ignores tracking parameters", () => {
    expect(bookingInvitationFromSearch("?utm_source=market&invitation=signed-token-123&utm_campaign=launch")).toBe("signed-token-123");
    expect(bookingInvitationFromSearch(`?invitation=${"x".repeat(513)}`)).toBe("");
    expect(bookingInvitationFromSearch("?utm_source=market")).toBe("");
  });
});
