-- The paired video's R2 key for a hand file, so a standalone Hand QC import (no
-- Clip row) can still overlay the skeleton on its <clip>.mp4.
ALTER TABLE "HandFile" ADD COLUMN "videoR2Key" TEXT;
