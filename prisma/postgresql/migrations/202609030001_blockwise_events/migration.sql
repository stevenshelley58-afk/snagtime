ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "blockwiseReference" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "eventId" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "payloadJson" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN IF NOT EXISTS "destinationUrl" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationOutbox_eventId_key" ON "IntegrationOutbox"("eventId");
