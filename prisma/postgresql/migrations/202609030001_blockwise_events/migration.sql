ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "blockwiseReference" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "eventId" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "payloadJson" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "destinationUrl" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "signingTimestamp" BIGINT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "signingSignature" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationOutbox_eventId_key" ON "IntegrationOutbox"("eventId");
