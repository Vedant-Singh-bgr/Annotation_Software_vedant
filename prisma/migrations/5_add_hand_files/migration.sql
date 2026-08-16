-- Ground-truth hand-tracking files (MANO .npz) reviewed as their own QC pass.
-- Separate from the clip/assignment tree; review-only.
CREATE TABLE "HandFile" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "npzR2Key" TEXT NOT NULL,
    "viewerR2Key" TEXT,
    "sizeBytes" DOUBLE PRECISION,
    "fps" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "handCount" INTEGER NOT NULL DEFAULT 2,
    "confirmedPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "droppedFrames" INTEGER NOT NULL DEFAULT 0,
    "sourceEtag" TEXT,
    "sourceVerifiedAt" TIMESTAMP(3),
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HandFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HandFile_npzR2Key_key" ON "HandFile"("npzR2Key");
CREATE INDEX "HandFile_reviewStatus_idx" ON "HandFile"("reviewStatus");
CREATE INDEX "HandFile_reviewedById_idx" ON "HandFile"("reviewedById");

-- Reviewer FK is SET NULL (not cascade): a departed reviewer must not delete the
-- QC record of the file they reviewed.
ALTER TABLE "HandFile" ADD CONSTRAINT "HandFile_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
