import { apiError, readBoundedText } from "@/server/http";
import { AppError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { executeBlockwiseBookingAction, blockwiseActionHeaders, BLOCKWISE_ACTION_MAX_BODY_BYTES, loadBlockwiseBookingActionSecret, parseBlockwiseBookingAction, verifyBlockwiseBookingActionSignature } from "@/server/services/blockwise-booking-actions";

type Context = { params: Promise<{ id: string }> };

/** Private Frank -> SnagTime booking mutation boundary. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await enforceRateLimit(`blockwise-booking-action:ip:${clientAddress(request)}`, 120, 60_000);
    const rawBody = await readBoundedText(request, BLOCKWISE_ACTION_MAX_BODY_BYTES);
    const headers = blockwiseActionHeaders(request);
    const secret = loadBlockwiseBookingActionSecret();
    if (!verifyBlockwiseBookingActionSignature({ rawBody, method: request.method, path: new URL(request.url).pathname, headers, secret })) {
      throw new AppError("INVALID_ACTION_SIGNATURE", "Action authentication failed.", 401);
    }
    if (!headers.nonce) throw new AppError("REPLAY_DETECTED", "Action replay was rejected.", 409);
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody) as unknown; } catch { throw new AppError("INVALID_ACTION", "Action envelope is invalid.", 400); }
    const action = parseBlockwiseBookingAction(parsed, id);
    if (headers.workspaceId && headers.workspaceId !== action.workspaceId) throw new AppError("TENANT_BINDING_REQUIRED", "Action tenant binding is invalid.", 403);
    await enforceRateLimit(`blockwise-booking-action:workspace:${action.workspaceId}`, 120, 60_000);
    const result = await executeBlockwiseBookingAction(action, rawBody, headers.nonce);
    const response = Response.json({ data: result });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return apiError(error); }
}
