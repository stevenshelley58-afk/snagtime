ALTER TABLE "IntegrationOutbox" ADD COLUMN "signingTimestamp" BIGINT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "signingSignature" TEXT;
