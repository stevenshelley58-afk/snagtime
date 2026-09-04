CREATE TABLE IF NOT EXISTS "BlockwiseBookingAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actionId" TEXT NOT NULL UNIQUE,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "nonce" TEXT NOT NULL UNIQUE,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "bookingId" TEXT NOT NULL REFERENCES "Booking"("id") ON DELETE CASCADE,
  "action" TEXT NOT NULL,
  "expectedVersion" INTEGER NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "resultJson" TEXT,
  "errorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "BlockwiseBookingAction_workspaceId_createdAt_idx" ON "BlockwiseBookingAction"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "BlockwiseBookingAction_bookingId_createdAt_idx" ON "BlockwiseBookingAction"("bookingId", "createdAt");
CREATE INDEX IF NOT EXISTS "BlockwiseBookingAction_status_leaseExpiresAt_idx" ON "BlockwiseBookingAction"("status", "leaseExpiresAt");
ALTER TABLE "BlockwiseBookingAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BlockwiseBookingAction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_provider_blockwise_action ON "BlockwiseBookingAction";
CREATE POLICY app_provider_blockwise_action ON "BlockwiseBookingAction" FOR ALL TO tempocove_app
USING (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='blockwise_booking_action' AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1))
WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='blockwise_booking_action' AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1));
