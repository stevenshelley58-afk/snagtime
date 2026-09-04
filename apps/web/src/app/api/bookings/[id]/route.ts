import { requireBookingManageSession } from "@/server/auth/capabilities";
import { assertSameOrigin, getSessionRecord } from "@/server/auth/session";
import { apiError, jsonBody, ok } from "@/server/http";
import { cancelBooking, getBookingDetail, getBookingForHost, rescheduleBooking } from "@/server/services/bookings";
import { cancelBookingInput, rescheduleBookingInput } from "@/server/validation";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";

type Context = { params: Promise<{ id: string }> };
async function authorize(request: Request, id: string, scope: "read" | "cancel" | "reschedule") {
  const organizer = await getSessionRecord(request);
  if (organizer) { await getBookingForHost(organizer.activeWorkspaceId, id); return { authorityKey: `organizer:${organizer.id}`, workspaceId: organizer.activeWorkspaceId }; }
  const session = await requireBookingManageSession(request, id, scope); return { authorityKey: `manage:${id}:${session.id}`, workspaceId: undefined };
}

export async function GET(request: Request, context: Context) {
  try {
    await enforceRateLimit(`manage-attempt:ip:${clientAddress(request)}`,240,60_000);
    const { id } = await context.params; const authorityKey = await authorize(request, id, "read");
    await enforceRateLimit(`manage-booking:${authorityKey.authorityKey}`, 120, 60_000);
    return ok(await getBookingDetail(id, authorityKey.workspaceId));
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(`manage-attempt:ip:${clientAddress(request)}`,240,60_000);
    const { id } = await context.params; const body = rescheduleBookingInput.parse(await jsonBody(request));
    const authorityKey = await authorize(request, id, "reschedule"); await enforceRateLimit(`manage-booking:${authorityKey.authorityKey}`, 120, 60_000); return ok(await rescheduleBooking(id, body.startAt, undefined, authorityKey.workspaceId));
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(`manage-attempt:ip:${clientAddress(request)}`,240,60_000);
    const { id } = await context.params; const body = cancelBookingInput.parse(await jsonBody(request));
    const authorityKey = await authorize(request, id, "cancel"); await enforceRateLimit(`manage-booking:${authorityKey.authorityKey}`, 120, 60_000); return ok(await cancelBooking(id, body.reason, authorityKey.workspaceId));
  } catch (error) { return apiError(error); }
}
