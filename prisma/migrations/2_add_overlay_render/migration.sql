-- Burned-in overlay MP4 per assignment: the labels rendered onto the video, so
-- the delivered artefact is watchable without the platform. Queued on publish.
ALTER TABLE "Assignment" ADD COLUMN "overlayStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Assignment" ADD COLUMN "overlayR2Key" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "overlayError" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "overlaySource" TEXT NOT NULL DEFAULT 'original';
ALTER TABLE "Assignment" ADD COLUMN "overlayRenderedAt" TIMESTAMP(3);
