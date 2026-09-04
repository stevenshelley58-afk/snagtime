import { describe, expect, it, vi } from "vitest";
import { BLOCKWISE_BOOKING_SPEC, blockwiseWebhookConfigured, buildBlockwiseBookingEvent, signBlockwisePayload, verifyBlockwiseSignature } from "@/server/services/blockwise-events";
import { assertFreeOnlyPrice, freeOnlyEnabled } from "@/server/free-only";
import { blockwiseDeliveryRequest } from "@/server/services/blockwise-delivery";

const secret = "blockwise-test-secret-with-at-least-32-bytes";
const booking = {
  id: "booking-a", eventTypeId: "event-a", workspaceId: "workspace-a", blockwiseReference: "invite-a",
  inviteeName: "A Customer", inviteeEmail: "Customer@Example.com", inviteeTimeZone: "Australia/Perth",
  startAt: new Date("2026-09-02T01:00:00.000Z"), endAt: new Date("2026-09-02T01:30:00.000Z"), status: "CONFIRMED",
  eventType: { slug: "intro" },
} as const;

describe("Blockwise booking event contract", () => {
  it("produces a strict frozen envelope with an immutable UUID and no payment/calendar secrets", () => {
    const event = buildBlockwiseBookingEvent(booking, "created", "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0", new Date("2026-09-01T00:00:00Z"));
    expect(event).toEqual({ spec: BLOCKWISE_BOOKING_SPEC, id: "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0", type: "booking.created", occurredAt: "2026-09-01T00:00:00.000Z", data: {
      booking: { uid: "booking-a", eventTypeId: "event-a", startTime: "2026-09-02T01:00:00.000Z", endTime: "2026-09-02T01:30:00.000Z", rescheduleUrl: null }, invitation: "invite-a", attendee: { name: "A Customer", email: "customer@example.com" },
    } });
    expect(JSON.stringify(event)).not.toMatch(/stripe|oauth|token|password|notes/i);
    expect(event.data.invitation).toBe("invite-a");
    expect(event.data.booking.rescheduleUrl).toBeNull();
  });

  it("signs the raw body with a timestamp and rejects tampering/replay", () => {
    const raw = JSON.stringify(buildBlockwiseBookingEvent(booking, "rescheduled", "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0"));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `sha256=${signBlockwisePayload(raw, timestamp, secret)}`;
    expect(verifyBlockwiseSignature(raw, String(timestamp), signature, secret)).toBe(true);
    expect(verifyBlockwiseSignature(`${raw} `, String(timestamp), signature, secret)).toBe(false);
    expect(verifyBlockwiseSignature(raw, String(timestamp - 301), signature, secret, Date.now())).toBe(false);
  });

  it("keeps the exact body, event ID, and signed wire headers stable across retries", () => {
    vi.stubEnv("BLOCKWISE_WEBHOOK_SECRET", secret);
    const body = JSON.stringify(buildBlockwiseBookingEvent(booking, "created", "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0"));
    const first = blockwiseDeliveryRequest(body, "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0", 1770000000);
    const retry = blockwiseDeliveryRequest(body, "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0", 1770000000);
    expect(first).toEqual(retry);
    expect(first.headers["x-snagtime-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(first.body).toBe(body);
    vi.unstubAllEnvs();
  });
});

describe("Blockwise configuration gate", () => {
  it("requires HTTPS and a strong secret before a referenced booking can be accepted", () => {
    vi.stubEnv("BLOCKWISE_WEBHOOK_URL", "https://blockwise.example/webhooks/snagtime");
    vi.stubEnv("BLOCKWISE_WEBHOOK_SECRET", secret);
    expect(blockwiseWebhookConfigured()).toBe(true);
    vi.stubEnv("BLOCKWISE_WEBHOOK_URL", "http://blockwise.example/webhooks/snagtime");
    expect(blockwiseWebhookConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("FREE_ONLY server gate", () => {
  it("rejects paid prices while leaving upstream behavior unchanged when disabled", () => {
    vi.stubEnv("FREE_ONLY", "true");
    expect(freeOnlyEnabled()).toBe(true);
    expect(() => assertFreeOnlyPrice(1)).toThrow(/FREE_ONLY/);
    expect(() => assertFreeOnlyPrice(0)).not.toThrow();
    vi.stubEnv("FREE_ONLY", "false");
    expect(freeOnlyEnabled()).toBe(false);
    expect(() => assertFreeOnlyPrice(1)).not.toThrow();
    vi.unstubAllEnvs();
  });
});
