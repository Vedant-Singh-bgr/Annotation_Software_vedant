-- Named groups for hand files, the hand-QC analogue of a clip Batch.
CREATE TABLE "HandBatch" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HandBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HandBatch_createdAt_idx" ON "HandBatch"("createdAt");

ALTER TABLE "HandFile" ADD COLUMN "batchId" TEXT;

ALTER TABLE "HandFile"
  ADD CONSTRAINT "HandFile_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "HandBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "HandFile_batchId_idx" ON "HandFile"("batchId");
