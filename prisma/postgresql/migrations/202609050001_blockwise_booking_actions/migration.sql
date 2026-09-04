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
  "operatorId" TEXT NOT NULL,
  "operatorRole" TEXT NOT NULL,
  "operatorAal" TEXT NOT NULL,
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
GRANT SELECT, INSERT, UPDATE, DELETE ON "BlockwiseBookingAction" TO tempocove_app;
ALTER TABLE "BlockwiseBookingAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BlockwiseBookingAction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_provider_blockwise_action ON "BlockwiseBookingAction";
CREATE POLICY app_provider_blockwise_action ON "BlockwiseBookingAction" FOR ALL TO tempocove_app
USING (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='blockwise_booking_action' AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1))
WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='blockwise_booking_action' AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1));

-- The action handler reuses booking mutation code, but its provider context is
-- deliberately narrower than provider_commit: only the bound booking/tenant
-- may be read or changed during this request.
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "blockwiseTenantId" TEXT;
CREATE INDEX IF NOT EXISTS "Booking_blockwiseTenantId_idx" ON "Booking"("blockwiseTenantId");
ALTER TABLE "BlockwiseBookingAction" DROP CONSTRAINT IF EXISTS "BlockwiseBookingAction_workspaceId_fkey";

CREATE OR REPLACE FUNCTION tempocove_blockwise_booking_relation(row_booking text, row_workspace text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tempocove_context_valid('provider')
    AND current_setting('tempocove.action',true) = 'blockwise_booking_action'
    AND row_workspace = current_setting('tempocove.workspace_id',true)
    AND row_booking = split_part(current_setting('tempocove.subject',true),'|',1)
$$;
ALTER FUNCTION tempocove_blockwise_booking_relation(text,text) OWNER TO tempocove_rls_verifier;
REVOKE ALL ON FUNCTION tempocove_blockwise_booking_relation(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_blockwise_booking_relation(text,text) TO tempocove_app;

DROP POLICY IF EXISTS app_workspace_booking_write ON "Booking";
CREATE POLICY app_workspace_booking_write ON "Booking" FOR UPDATE TO tempocove_app
USING (tempocove_blockwise_booking_relation(id,"blockwiseTenantId") OR (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write'))
WITH CHECK (tempocove_blockwise_booking_relation(id,"blockwiseTenantId") OR (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write'));
DROP POLICY IF EXISTS app_workspace_occupancy_delete ON "BookingOccupancy";
CREATE POLICY app_workspace_occupancy_delete ON "BookingOccupancy" FOR DELETE TO tempocove_app
USING (tempocove_blockwise_booking_relation("bookingId",(SELECT b."blockwiseTenantId" FROM "Booking" b WHERE b.id="bookingId")) OR (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write'));
DROP POLICY IF EXISTS app_workspace_occupancy_insert ON "BookingOccupancy";
CREATE POLICY app_workspace_occupancy_insert ON "BookingOccupancy" FOR INSERT TO tempocove_app
WITH CHECK (tempocove_blockwise_booking_relation("bookingId",(SELECT b."blockwiseTenantId" FROM "Booking" b WHERE b.id="bookingId") ) OR (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write'));
DROP POLICY IF EXISTS app_workspace_booking_email_insert ON "EmailOutbox";
CREATE POLICY app_workspace_booking_email_insert ON "EmailOutbox" FOR INSERT TO tempocove_app WITH CHECK (
  (tempocove_blockwise_booking_relation("bookingId",(SELECT b."blockwiseTenantId" FROM "Booking" b WHERE b.id="bookingId") ) OR current_setting('tempocove.action',true)='booking_write')
  AND "bookingId" IS NOT NULL AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL
  AND EXISTS (SELECT 1 FROM "Booking" b JOIN "User" h ON h.id=b."hostId" WHERE b.id="bookingId" AND b."workspaceId"="EmailOutbox"."workspaceId" AND lower("recipientEmail") IN (lower(b."inviteeEmail"),lower(h.email))));
DROP POLICY IF EXISTS app_workspace_booking_outbox_insert ON "IntegrationOutbox";
CREATE POLICY app_workspace_booking_outbox_insert ON "IntegrationOutbox" FOR INSERT TO tempocove_app WITH CHECK (
  (tempocove_blockwise_booking_relation("bookingId",(SELECT b."blockwiseTenantId" FROM "Booking" b WHERE b.id="bookingId") ) OR current_setting('tempocove.action',true)='booking_write')
  AND (tempocove_blockwise_booking_relation("bookingId",(SELECT b."blockwiseTenantId" FROM "Booking" b WHERE b.id="bookingId") ) OR tempocove_booking_actor("bookingId"))
  AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL);
