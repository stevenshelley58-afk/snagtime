ALTER TABLE "IntegrationOutbox" ADD COLUMN "signingTimestamp" INTEGER;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "signingSignature" TEXT;
