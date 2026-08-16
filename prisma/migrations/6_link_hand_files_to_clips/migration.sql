-- Link a hand file to the clip it was captured from (…/<clip>.hands.npz beside
-- …/<clip>.mp4), so the Hand QC review page can load the paired video. Nullable
-- + ON DELETE SET NULL: standalone hand files have no clip, and removing a clip
-- must not delete the QC verdict on its hand tracking.
ALTER TABLE "HandFile" ADD COLUMN "clipId" TEXT;

ALTER TABLE "HandFile"
  ADD CONSTRAINT "HandFile_clipId_fkey"
  FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "HandFile_clipId_idx" ON "HandFile"("clipId");
