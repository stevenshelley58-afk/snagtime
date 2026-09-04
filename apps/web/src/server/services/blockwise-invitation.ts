import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/server/errors";
import { loadBlockwiseBookingActionSecret } from "@/server/services/blockwise-booking-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type BlockwiseInvitation = { tenantId: string; reference: string; expiresAt: Date; nonce: string };
export function verifyBlockwiseInvitationCapability(token: string, now = new Date()): BlockwiseInvitation {
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "bw1" || !UUID.test(parts[1]!) || !parts[2] || !/^\d{13}$/.test(parts[3]!) || !/^[A-Za-z0-9_-]{16,256}$/.test(parts[4]!) || !/^[A-Za-z0-9_-]{40,}$/.test(parts[5]!)) throw new AppError("INVALID_BLOCKWISE_CAPABILITY", "Blockwise invitation capability is invalid.", 403);
  const payload = parts.slice(0, 5).join("."); const expected = createHmac("sha256", loadBlockwiseBookingActionSecret()).update(payload).digest("base64url");
  const a = Buffer.from(parts[5]!); const b = Buffer.from(expected); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError("INVALID_BLOCKWISE_CAPABILITY", "Blockwise invitation capability is invalid.", 403);
  const expiresAt = new Date(Number(parts[3])); if (expiresAt <= now) throw new AppError("BLOCKWISE_CAPABILITY_EXPIRED", "Blockwise invitation capability has expired.", 403);
  return { tenantId: parts[1]!.toLowerCase(), reference: parts[2]!, expiresAt, nonce: parts[4]! };
}
