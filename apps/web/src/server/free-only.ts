import { AppError } from "@/server/errors";

export function freeOnlyEnabled() { return process.env.FREE_ONLY === "true"; }
export function assertFreeOnlyPrice(priceCents: number) {
  if (freeOnlyEnabled() && priceCents > 0) throw new AppError("FREE_ONLY_MODE", "Paid bookings are disabled in FREE_ONLY mode.", 403);
}
