-- QC reviewer routing: an org admin can route an assignment to a specific QC
-- person, who reviews only what is routed to them (unlike an org admin, who
-- sees the whole org).
--
-- All nullable with no backfill, so existing rows are untouched and an unrouted
-- assignment stays reviewable by the org admin exactly as before. An older app
-- version serving during the migration never selects these columns.
ALTER TABLE "Assignment" ADD COLUMN "reviewerId" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "Assignment_reviewerId_idx" ON "Assignment"("reviewerId");

-- ON DELETE SET NULL, deliberately NOT the CASCADE used for annotatorId:
-- cascading from a reviewer would destroy the ANNOTATOR's entire Task /
-- SubTask / FrameQuality tree when a departed reviewer's user row is deleted.
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
