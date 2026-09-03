import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma, Booking } from "@prisma/client";

export const BLOCKWISE_BOOKING_SPEC = "blockwise.booking.v1" as const;
export type BlockwiseBookingLifecycle = "created" | "rescheduled" | "cancelled";
export type BlockwiseBookingEvent = {
  spec: typeof BLOCKWISE_BOOKING_SPEC;
  id: string;
  type: `booking.${BlockwiseBookingLifecycle}`;
  occurredAt: string;
  data: {
    booking: { uid: string; eventTypeId: string; startTime: string; endTime: string; rescheduleUrl: string | null };
    invitation: string;
    attendee: { name: string; email: string };
  };
};

type BookingEventSnapshot = Pick<Booking, "id" | "eventTypeId" | "workspaceId" | "inviteeName" | "inviteeEmail" | "startAt" | "endAt"> & { blockwiseReference: string };

export function blockwiseSnapshot(booking: Booking): BookingEventSnapshot | null {
  return booking.blockwiseReference ? { id: booking.id, eventTypeId: booking.eventTypeId, workspaceId: booking.workspaceId, inviteeName: booking.inviteeName, inviteeEmail: booking.inviteeEmail, startAt: booking.startAt, endAt: booking.endAt, blockwiseReference: booking.blockwiseReference } : null;
}

function webhookSecret() {
  const secret = process.env.BLOCKWISE_WEBHOOK_SECRET || "";
  if (Buffer.byteLength(secret) < 32) throw new Error("BLOCKWISE_WEBHOOK_SECRET must contain at least 32 bytes.");
  return secret;
}

export function blockwiseWebhookConfigured() {
  return Boolean(process.env.BLOCKWISE_WEBHOOK_URL?.startsWith("https://") && Buffer.byteLength(process.env.BLOCKWISE_WEBHOOK_SECRET || "") >= 32);
}

export function signBlockwisePayload(rawBody: string, timestamp: number | string, secret = webhookSecret()) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyBlockwiseSignature(rawBody: string, timestamp: string, supplied: string, secret = webhookSecret(), now = Date.now()) {
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) return false;
  const normalized = supplied.startsWith("sha256=") ? supplied.slice(7) : supplied;
  if (!/^[0-9a-f]{64}$/i.test(normalized)) return false;
  const expected = signBlockwisePayload(rawBody, seconds, secret);
  return timingSafeEqual(Buffer.from(normalized.toLowerCase()), Buffer.from(expected));
}

export function buildBlockwiseBookingEvent(booking: BookingEventSnapshot, kind: BlockwiseBookingLifecycle, id = randomUUID(), occurredAt = new Date()) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const event: BlockwiseBookingEvent = {
    spec: BLOCKWISE_BOOKING_SPEC,
    id,
    type: `booking.${kind}`,
    occurredAt: occurredAt.toISOString(),
    data: {
      booking: {
        uid: booking.id,
        eventTypeId: booking.eventTypeId,
        startTime: booking.startAt.toISOString(),
        endTime: booking.endAt.toISOString(),
        rescheduleUrl: null,
      },
      invitation: booking.blockwiseReference,
      attendee: { name: booking.inviteeName, email: booking.inviteeEmail.toLowerCase() },
    },
  };
  return event;
}

/** Persist the exact signed-body input before any network attempt. */
export async function enqueueBlockwiseBookingEvent(tx: Prisma.TransactionClient, booking: BookingEventSnapshot, kind: BlockwiseBookingLifecycle, occurredAt = new Date()) {
  const event = buildBlockwiseBookingEvent(booking, kind, randomUUID(), occurredAt);
  const payloadJson = JSON.stringify(event);
  return tx.integrationOutbox.create({ data: {
    workspaceId: booking.workspaceId,
    bookingId: booking.id,
    kind: "BLOCKWISE_BOOKING_EVENT",
    eventId: event.id,
    payloadJson,
    destinationUrl: process.env.BLOCKWISE_WEBHOOK_URL || null,
    idempotencyKey: `blockwise:booking:${event.id}`,
  } });
}
