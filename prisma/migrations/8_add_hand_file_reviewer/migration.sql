-- QC routing for hand files: assign a file to a specific reviewer, like an
-- annotation Assignment.reviewerId. Nullable + ON DELETE SET NULL.
ALTER TABLE "HandFile" ADD COLUMN "reviewerId" TEXT;

ALTER TABLE "HandFile"
  ADD CONSTRAINT "HandFile_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "HandFile_reviewerId_reviewStatus_idx" ON "HandFile"("reviewerId", "reviewStatus");
