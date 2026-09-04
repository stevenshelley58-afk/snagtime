ALTER TABLE "Booking" ADD COLUMN "blockwiseReference" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "eventId" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "payloadJson" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "destinationUrl" TEXT;
CREATE UNIQUE INDEX "IntegrationOutbox_eventId_key" ON "IntegrationOutbox"("eventId");
