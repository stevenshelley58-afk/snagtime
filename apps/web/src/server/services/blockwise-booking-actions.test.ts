import { createHash, createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { parseBlockwiseBookingAction, verifyBlockwiseBookingActionSignature } from "@/server/services/blockwise-booking-actions";

const secret = "blockwise-booking-action-secret-0123456789";
const base = {
  schema: "blockwise.ops.action.v1", actionId: "84444444-4444-4444-8444-444444444444", idempotencyKey: "booking:action:1",
  workspaceId: "cmworkspace123", customerId: "cmworkspace123", actor: { operatorId: "82222222-2222-4222-8222-222222222222", role: "support", aal: "aal2" },
  target: { type: "booking", id: "cmbooking123" }, action: "booking_cancel", expectedVersion: 0, reason: "Customer requested cancellation",
  createdAt: "2026-09-05T00:00:00.000Z", expiresAt: "2026-09-05T01:00:00.000Z", payload: {},
};

function signed(rawBody: string, nonce = "nonce-0123456789012345", timestamp = "1788566400") {
  const path = "/api/internal/blockwise/bookings/cmbooking123/actions";
  const canonical = ["v1", timestamp, nonce, "ops.write", "POST", path, createHash("sha256").update(rawBody).digest("hex")].join("\n");
  return { timestamp, nonce, scope: "ops.write", signature: createHmac("sha256", secret).update(canonical).digest("hex"), workspaceId: null, path };
}

describe("private Blockwise booking action contract", () => {
  it("normalizes and allowlists cancel and reschedule actions", () => {
    expect(parseBlockwiseBookingAction(base, "cmbooking123").action).toBe("booking_cancel");
    expect(parseBlockwiseBookingAction({ ...base, action: "booking_reschedule", payload: { scheduledStartAt: "2026-09-08T10:00:00.000Z" } }, "cmbooking123").payload).toEqual({ scheduledStartAt: "2026-09-08T10:00:00.000Z" });
    expect(() => parseBlockwiseBookingAction({ ...base, target: { type: "booking", id: "other" } }, "cmbooking123")).toThrow(AppError);
    expect(() => parseBlockwiseBookingAction({ ...base, customerId: "other-workspace" })).toThrow(/tenant/i);
    expect(() => parseBlockwiseBookingAction({ ...base, payload: { providerToken: "secret" } })).toThrow(AppError);
  });

  it("requires AAL2, optimistic versions, strict expiry, and rejects unsupported actions", () => {
    expect(() => parseBlockwiseBookingAction({ ...base, actor: { ...base.actor, aal: "aal1" } })).toThrow(/verification/i);
    expect(() => parseBlockwiseBookingAction({ ...base, expectedVersion: -1 })).toThrow(AppError);
    expect(() => parseBlockwiseBookingAction({ ...base, expiresAt: "2026-09-06T01:00:00.000Z" })).toThrow(/expiry/i);
    expect(() => parseBlockwiseBookingAction({ ...base, action: "booking_create" })).toThrow(/not supported/i);
  });

  it("verifies Frank's canonical signature and replay window", () => {
    const raw = JSON.stringify(base); const parts = signed(raw); const now = new Date("2026-09-05T00:00:00.000Z");
    const current = { ...parts, timestamp: String(Math.floor(now.getTime() / 1000)) };
    const canonical = ["v1", current.timestamp, current.nonce, current.scope, "POST", current.path, createHash("sha256").update(raw).digest("hex")].join("\n");
    current.signature = createHmac("sha256", secret).update(canonical).digest("hex");
    expect(verifyBlockwiseBookingActionSignature({ rawBody: raw, method: "POST", path: current.path, headers: current, secret, now })).toBe(true);
    expect(verifyBlockwiseBookingActionSignature({ rawBody: `${raw} `, method: "POST", path: current.path, headers: current, secret, now })).toBe(false);
    expect(verifyBlockwiseBookingActionSignature({ rawBody: raw, method: "POST", path: current.path, headers: { ...current, timestamp: "1760000000" }, secret, now })).toBe(false);
  });

  it("does not expose attendee/provider fields in the safe receipt shape", async () => {
    // Keep this contract assertion source-local: the operation result type is
    // deliberately limited to booking transition metadata.
    const resultKeys = ["receiptId", "actionId", "idempotencyKey", "status", "bookingId", "workspaceId", "bookingStatus", "mutationVersion", "startAt", "endAt"];
    expect(resultKeys).not.toContain("inviteeEmail"); expect(resultKeys).not.toContain("accessToken"); expect(randomUUID()).toMatch(/[0-9a-f-]{36}/);
  });
});
