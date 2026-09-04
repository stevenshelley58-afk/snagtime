import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { enterDatabaseAction, enterProviderDatabaseContext } from "@/server/db-context";
import { AppError } from "@/server/errors";
import { cancelBooking, rescheduleBooking } from "@/server/services/bookings";

export const BLOCKWISE_ACTION_SCHEMA = "blockwise.ops.action.v1" as const;
export const BLOCKWISE_ACTION_REPLAY_WINDOW_SECONDS = 300;
export const BLOCKWISE_ACTION_MAX_BODY_BYTES = 32 * 1024;
const ACTION_LEASE_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9:._/-]{7,255}$/;
const NONCE = /^[A-Za-z0-9_-]{16,256}$/;

export type BlockwiseBookingAction = "booking_cancel" | "booking_reschedule";
export type BlockwiseBookingActionEnvelope = {
  schema: typeof BLOCKWISE_ACTION_SCHEMA;
  actionId: string;
  idempotencyKey: string;
  workspaceId: string;
  customerId: string;
  actor: { operatorId: string; role: "owner" | "support"; aal: "aal2" };
  target: { type: "booking"; id: string };
  action: BlockwiseBookingAction;
  expectedVersion: number;
  reason: string;
  createdAt: string;
  expiresAt: string;
  payload: { scheduledStartAt: string; scheduledEndAt?: string } | Record<string, never>;
};
export type BlockwiseBookingActionResult = {
  receiptId: string; actionId: string; idempotencyKey: string; status: "ACCEPTED"; calendarStatus: "PENDING" | "SYNCED" | "FAILED";
  bookingId: string; workspaceId: string; bookingStatus: string; mutationVersion: number; startAt: string; endAt: string;
};
type ActionHeaders = { timestamp: string | null; nonce: string | null; scope: string | null; signature: string | null; workspaceId: string | null };

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("INVALID_ACTION", `${label} is invalid.`, 400);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AppError("INVALID_ACTION", `${label} is invalid.`, 400);
  return value.trim();
}
function uuid(value: unknown, label: string) {
  const normalized = string(value, label, 128).toLowerCase();
  if (!UUID.test(normalized)) throw new AppError("INVALID_ACTION", `${label} is invalid.`, 400);
  return normalized;
}
function timestamp(value: unknown, label: string) {
  const normalized = string(value, label, 24); const date = new Date(normalized);
  if (!ISO.test(normalized) || !Number.isFinite(date.getTime()) || date.toISOString() !== normalized) throw new AppError("INVALID_ACTION", `${label} is invalid.`, 400);
  return normalized;
}
const ACTION_CLOCK_SKEW_MS = 30_000;
export function assertActionTimeWindow(action: Pick<BlockwiseBookingActionEnvelope, "createdAt" | "expiresAt">, now: Date) {
  const created = Date.parse(action.createdAt); const expires = Date.parse(action.expiresAt); const current = now.getTime();
  if (current + ACTION_CLOCK_SKEW_MS < created || current - ACTION_CLOCK_SKEW_MS > expires)
    throw new AppError("ACTION_EXPIRED", "Action is outside its authenticated time window.", 409);
}

/** Parse only the allowlisted Frank action shape. */
export function parseBlockwiseBookingAction(input: unknown, routeBookingId?: string): BlockwiseBookingActionEnvelope {
  const value = record(input, "action");
  const allowed = ["schema", "actionId", "idempotencyKey", "workspaceId", "customerId", "actor", "target", "action", "expectedVersion", "reason", "createdAt", "expiresAt", "payload"];
  if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value))) throw new AppError("INVALID_ACTION", "Action envelope is invalid.", 400);
  if (value.schema !== BLOCKWISE_ACTION_SCHEMA) throw new AppError("UNSUPPORTED_ACTION_SCHEMA", "Action schema is unsupported.", 400);
  const actionId = uuid(value.actionId, "actionId"); const idempotencyKey = string(value.idempotencyKey, "idempotencyKey", 256);
  if (!IDEMPOTENCY.test(idempotencyKey)) throw new AppError("INVALID_IDEMPOTENCY_KEY", "Idempotency key is invalid.", 400);
  // Keep the external tenant binding opaque here; the adapter must resolve it
  // to SnagTime's internal CUID before executing any database operation.
  const workspaceId = string(value.workspaceId, "workspaceId", 128); const customerId = string(value.customerId, "customerId", 128);
  if (workspaceId !== customerId) throw new AppError("TENANT_BINDING_REQUIRED", "Action tenant binding is invalid.", 403);
  const actorValue = record(value.actor, "actor"); const actor = { operatorId: uuid(actorValue.operatorId, "actor.operatorId"), role: actorValue.role, aal: actorValue.aal } as BlockwiseBookingActionEnvelope["actor"];
  if (actor.role !== "owner" && actor.role !== "support") throw new AppError("INVALID_ACTION", "Actor role is invalid.", 400);
  if (actor.aal !== "aal2") throw new AppError("OPERATOR_AAL2_REQUIRED", "Operator verification is required.", 403);
  const targetValue = record(value.target, "target"); if (targetValue.type !== "booking") throw new AppError("INVALID_ACTION", "Action target is invalid.", 400);
  const targetId = string(targetValue.id, "target.id", 128); if (routeBookingId && targetId !== routeBookingId) throw new AppError("TENANT_BINDING_REQUIRED", "Action target is invalid.", 403);
  const action = value.action; if (action !== "booking_cancel" && action !== "booking_reschedule") throw new AppError("UNSUPPORTED_ACTION", "Booking action is not supported.", 501);
  const expectedVersion = value.expectedVersion; if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new AppError("INVALID_ACTION", "expectedVersion is invalid.", 400);
  const reason = string(value.reason, "reason", 500); const createdAt = timestamp(value.createdAt, "createdAt"); const expiresAt = timestamp(value.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(createdAt) || Date.parse(expiresAt) - Date.parse(createdAt) > 24 * 60 * 60_000) throw new AppError("INVALID_ACTION_EXPIRY", "Action expiry is invalid.", 400);
  const payload = record(value.payload, "payload");
  if (action === "booking_cancel") {
    if (Object.keys(payload).length) throw new AppError("INVALID_ACTION", "Action payload is invalid.", 400);
    return { schema: BLOCKWISE_ACTION_SCHEMA, actionId, idempotencyKey, workspaceId, customerId, actor, target: { type: "booking", id: targetId }, action, expectedVersion, reason, createdAt, expiresAt, payload: {} };
  }
  const keys = Object.keys(payload); if (keys.some((key) => !["scheduledStartAt", "scheduledEndAt"].includes(key)) || !("scheduledStartAt" in payload)) throw new AppError("INVALID_ACTION", "Action payload is invalid.", 400);
  const scheduledStartAt = timestamp(payload.scheduledStartAt, "payload.scheduledStartAt"); const scheduledEndAt = payload.scheduledEndAt === undefined ? undefined : timestamp(payload.scheduledEndAt, "payload.scheduledEndAt");
  if (scheduledEndAt && Date.parse(scheduledEndAt) <= Date.parse(scheduledStartAt)) throw new AppError("INVALID_ACTION", "Action schedule is invalid.", 400);
  return { schema: BLOCKWISE_ACTION_SCHEMA, actionId, idempotencyKey, workspaceId, customerId, actor, target: { type: "booking", id: targetId }, action, expectedVersion, reason, createdAt, expiresAt, payload: scheduledEndAt ? { scheduledStartAt, scheduledEndAt } : { scheduledStartAt } };
}

function secretFromFile() {
  const path = process.env.BLOCKWISE_BOOKING_ACTION_SECRET_FILE?.trim() || "";
  if (!path || !isAbsolute(path)) throw new AppError("ACTION_AUTH_UNAVAILABLE", "Booking action authentication is unavailable.", 503);
  try {
    // Validate every ancestor, not only the leaf: a symlinked or writable
    // mount parent can replace an otherwise safe-looking secret at runtime.
    let cursor = resolve(path); const ancestors: string[] = [];
    while (true) { ancestors.push(cursor); const parent = resolve(cursor, ".."); if (parent === cursor) break; cursor = parent; }
    for (const ancestor of ancestors) {
      const parentInfo = lstatSync(ancestor);
      if (parentInfo.isSymbolicLink() || (!parentInfo.isDirectory() && ancestor !== resolve(path))) throw new Error("invalid secret path ancestor");
      if (process.platform !== "win32" && ancestor !== resolve(path) && (parentInfo.mode & 0o022) !== 0) throw new Error("secret directory permissions are too broad");
    }
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || resolve(path) !== path || info.size > 4096) throw new Error("invalid secret file");
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("secret file permissions are too broad");
    const secret = readFileSync(path, "utf8").trim();
    if (Buffer.byteLength(secret) < 32 || /[^\x21-\x7e]/.test(secret)) throw new Error("invalid secret");
    return secret;
  } catch { throw new AppError("ACTION_AUTH_UNAVAILABLE", "Booking action authentication is unavailable.", 503); }
}

/** Verify Frank's canonical HMAC request before parsing or touching tenant data. */
export function verifyBlockwiseBookingActionSignature(input: { rawBody: string; method: string; path: string; headers: ActionHeaders; secret: string; now?: Date; replayWindowSeconds?: number }) {
  const { timestamp: timestampHeader, nonce, scope, signature } = input.headers;
  if (!timestampHeader || !nonce || !scope || !signature || scope !== "ops.write" || !NONCE.test(nonce) || !/^\d{10}$/.test(timestampHeader)) return false;
  const seconds = Number(timestampHeader); const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000); const window = input.replayWindowSeconds ?? BLOCKWISE_ACTION_REPLAY_WINDOW_SECONDS;
  if (!Number.isSafeInteger(seconds) || Math.abs(nowSeconds - seconds) > window || !Number.isSafeInteger(window) || window < 1 || window > 3600) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const canonical = ["v1", timestampHeader, nonce, scope, input.method.toUpperCase(), input.path, createHash("sha256").update(input.rawBody).digest("hex")].join("\n");
  const expected = createHmac("sha256", input.secret).update(canonical).digest(); const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function blockwiseActionHeaders(request: Request): ActionHeaders {
  return { timestamp: request.headers.get("x-blockwise-timestamp"), nonce: request.headers.get("x-blockwise-nonce"), scope: request.headers.get("x-blockwise-scope"), signature: request.headers.get("x-blockwise-signature"), workspaceId: request.headers.get("x-blockwise-workspace-id") };
}

function safeResult(receiptId: string, action: BlockwiseBookingActionEnvelope, booking: { id: string; workspaceId: string; status: string; mutationVersion: number; startAt: Date; endAt: Date }): BlockwiseBookingActionResult {
  return { receiptId, actionId: action.actionId, idempotencyKey: action.idempotencyKey, status: "ACCEPTED", calendarStatus: "PENDING", bookingId: booking.id, workspaceId: booking.workspaceId, bookingStatus: booking.status, mutationVersion: booking.mutationVersion, startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString() };
}
function parseResult(value: string | null): BlockwiseBookingActionResult | null { if (!value) return null; try { const parsed = JSON.parse(value) as BlockwiseBookingActionResult; return parsed?.status === "ACCEPTED" ? parsed : null; } catch { return null; } }
function providerCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  return "ACTION_EXECUTION_FAILED";
}
function actionApplied(action: BlockwiseBookingActionEnvelope, booking: { status: string; mutationVersion: number; startAt: Date }) {
  if (booking.mutationVersion !== action.expectedVersion + 1) return false;
  if (action.action === "booking_cancel") return booking.status === "CANCELLED";
  return booking.status === "CONFIRMED" && booking.startAt.toISOString() === (action.payload as { scheduledStartAt: string }).scheduledStartAt;
}

async function reconcileExpiredAction(receipt: { id: string }, action: BlockwiseBookingActionEnvelope, now: Date) {
  const booking = await db.booking.findFirst({ where: { id: action.target.id, blockwiseTenantId: action.workspaceId } });
  if (booking && actionApplied(action, booking)) {
    const result = safeResult(receipt.id, action, booking);
    const settled = await db.blockwiseBookingAction.updateMany({ where: { id: receipt.id, status: "PROCESSING", leaseExpiresAt: { lte: now } }, data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), leaseToken: null, leaseExpiresAt: null } });
    if (settled.count === 1) return result;
    const current = await db.blockwiseBookingAction.findUnique({ where: { id: receipt.id } }); return parseResult(current?.resultJson ?? null);
  }
  await db.blockwiseBookingAction.updateMany({ where: { id: receipt.id, status: "PROCESSING", leaseExpiresAt: { lte: now } }, data: { status: "QUARANTINED", errorCode: "ACTION_QUARANTINED", leaseToken: null, leaseExpiresAt: null } });
  return null;
}

/** Reserve, execute, reconcile and settle one private Blockwise booking action. */
export async function executeBlockwiseBookingAction(action: BlockwiseBookingActionEnvelope, rawBody: string, transportNonce: string, now = new Date()): Promise<BlockwiseBookingActionResult> {
  assertActionTimeWindow(action, now);
  const requestFingerprint = createHash("sha256").update(rawBody).digest("hex");
  if (!NONCE.test(transportNonce)) throw new AppError("REPLAY_DETECTED", "Action replay was rejected.", 409);
  enterProviderDatabaseContext(action.target.id, action.workspaceId, "blockwise_booking_action");
  const priorNonce = await db.blockwiseBookingAction.findUnique({ where: { nonce: transportNonce } });
  if (priorNonce) {
    if (priorNonce.idempotencyKey !== action.idempotencyKey || priorNonce.requestFingerprint !== requestFingerprint) throw new AppError("REPLAY_DETECTED", "Action replay was rejected.", 409);
  }
  const leaseToken = randomUUID(); const leaseExpiresAt = new Date(now.getTime() + ACTION_LEASE_MS);
  let receipt = await db.blockwiseBookingAction.findUnique({ where: { idempotencyKey: action.idempotencyKey } });
  if (receipt) {
    if (receipt.workspaceId !== action.workspaceId || receipt.requestFingerprint !== requestFingerprint || receipt.bookingId !== action.target.id || receipt.action !== action.action) throw new AppError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for a different action.", 409);
    const replay = parseResult(receipt.resultJson); if (receipt.status === "SUCCEEDED" && replay) return replay;
    if (receipt.status !== "PROCESSING") throw new AppError(receipt.errorCode || "ACTION_QUARANTINED", "Action receipt is unavailable.", 409);
    if (receipt.leaseExpiresAt && receipt.leaseExpiresAt > now) throw new AppError("ACTION_IN_PROGRESS", "Action is already being processed.", 409);
    const reconciled = await reconcileExpiredAction(receipt, action, now); if (reconciled) return reconciled;
    throw new AppError("ACTION_QUARANTINED", "Action requires operator reconciliation before retrying.", 503);
  }
  const booking = await db.booking.findFirst({ where: { id: action.target.id, blockwiseTenantId: action.workspaceId } });
  if (!booking || !booking.blockwiseReference) throw new AppError("BOOKING_NOT_FOUND", "Booking is unavailable.", 404);
  if (booking.mutationVersion !== action.expectedVersion) throw new AppError("STALE_BOOKING_VERSION", "Booking changed; refresh the operator view.", 409);
  if (action.action === "booking_reschedule" && booking.status !== "CONFIRMED") throw new AppError("BOOKING_NOT_ACTIVE", "Booking is not active.", 409);
  if (action.action === "booking_cancel" && booking.status === "CANCELLED") throw new AppError("BOOKING_NOT_ACTIVE", "Booking is not active.", 409);
  if (action.action === "booking_reschedule") {
    const payload = action.payload as { scheduledStartAt: string; scheduledEndAt?: string };
    const expectedEnd = new Date(Date.parse(payload.scheduledStartAt) + booking.durationMinutes * 60_000).toISOString();
    if (payload.scheduledEndAt && payload.scheduledEndAt !== expectedEnd) throw new AppError("INVALID_ACTION", "Action schedule is invalid.", 400);
  }
  try {
    receipt = await db.blockwiseBookingAction.create({ data: { actionId: action.actionId, idempotencyKey: action.idempotencyKey, nonce: transportNonce, workspaceId: action.workspaceId, bookingId: action.target.id, action: action.action, expectedVersion: action.expectedVersion, requestFingerprint, payloadJson: JSON.stringify(action.payload), reason: action.reason, operatorId: action.actor.operatorId, operatorRole: action.actor.role, operatorAal: action.actor.aal, status: "PROCESSING", leaseToken, leaseExpiresAt, expiresAt: new Date(action.expiresAt) } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const winner = await db.blockwiseBookingAction.findUnique({ where: { idempotencyKey: action.idempotencyKey } });
    if (winner?.requestFingerprint === requestFingerprint && winner.status === "SUCCEEDED") { const replay = parseResult(winner.resultJson); if (replay) return replay; }
    throw new AppError("ACTION_IN_PROGRESS", "Action is already being processed.", 409);
  }
  try {
    // The signed workspaceId is Blockwise's external tenant UUID. The
    // database policy binds it to Booking.blockwiseTenantId; it is not the
    // internal SnagTime workspace CUID accepted by booking services.
    if (action.action === "booking_cancel") await cancelBooking(action.target.id, action.reason, undefined, action.expectedVersion);
    else await rescheduleBooking(action.target.id, (action.payload as { scheduledStartAt: string }).scheduledStartAt, undefined, undefined, action.expectedVersion);
    const finalBooking = await db.booking.findFirstOrThrow({ where: { id: action.target.id, blockwiseTenantId: action.workspaceId } });
    const resultJson = JSON.stringify(safeResult(receipt.id, action, finalBooking));
    enterDatabaseAction("blockwise_booking_action");
    const settled = await db.blockwiseBookingAction.updateMany({ where: { id: receipt.id, leaseToken }, data: { status: "SUCCEEDED", resultJson, leaseToken: null, leaseExpiresAt: null, errorCode: null } });
    if (settled.count !== 1) throw new AppError("ACTION_QUARANTINED", "Action requires operator reconciliation before retrying.", 503);
    return JSON.parse(resultJson) as BlockwiseBookingActionResult;
  } catch (error) {
    const finalBooking = await db.booking.findFirst({ where: { id: action.target.id, blockwiseTenantId: action.workspaceId } });
    if (finalBooking && actionApplied(action, finalBooking)) {
      const resultJson = JSON.stringify(safeResult(receipt.id, action, finalBooking));
      enterDatabaseAction("blockwise_booking_action");
      await db.blockwiseBookingAction.updateMany({ where: { id: receipt.id, leaseToken }, data: { status: "SUCCEEDED", resultJson, leaseToken: null, leaseExpiresAt: null, errorCode: null } });
      return JSON.parse(resultJson) as BlockwiseBookingActionResult;
    }
    const code = providerCode(error); enterDatabaseAction("blockwise_booking_action"); await db.blockwiseBookingAction.updateMany({ where: { id: receipt.id, leaseToken }, data: { status: error instanceof AppError ? "REJECTED" : "QUARANTINED", errorCode: code, leaseToken: null, leaseExpiresAt: null } });
    if (error instanceof AppError) throw error;
    throw new AppError("ACTION_QUARANTINED", "Action requires operator reconciliation before retrying.", 503);
  }
}

export function loadBlockwiseBookingActionSecret() { return secretFromFile(); }
