CREATE TABLE "BlockwiseBookingAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
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
  "leaseExpiresAt" DATETIME,
  "resultJson" TEXT,
  "errorCode" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BlockwiseBookingAction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BlockwiseBookingAction_actionId_key" ON "BlockwiseBookingAction"("actionId");
CREATE UNIQUE INDEX "BlockwiseBookingAction_idempotencyKey_key" ON "BlockwiseBookingAction"("idempotencyKey");
CREATE UNIQUE INDEX "BlockwiseBookingAction_nonce_key" ON "BlockwiseBookingAction"("nonce");
CREATE INDEX "BlockwiseBookingAction_workspaceId_createdAt_idx" ON "BlockwiseBookingAction"("workspaceId", "createdAt");
CREATE INDEX "BlockwiseBookingAction_bookingId_createdAt_idx" ON "BlockwiseBookingAction"("bookingId", "createdAt");
CREATE INDEX "BlockwiseBookingAction_status_leaseExpiresAt_idx" ON "BlockwiseBookingAction"("status", "leaseExpiresAt");
ALTER TABLE "Booking" ADD COLUMN "blockwiseTenantId" TEXT;
CREATE INDEX "Booking_blockwiseTenantId_idx" ON "Booking"("blockwiseTenantId");
