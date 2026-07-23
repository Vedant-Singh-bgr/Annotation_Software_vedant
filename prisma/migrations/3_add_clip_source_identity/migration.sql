-- Content identity of a clip's SOURCE object, captured from R2 at import.
-- Flat MP4 clips are otherwise linked to their annotations by key string alone,
-- with nothing to detect the bytes at that key being replaced. MCAP sessions
-- already carry ClipSegment.sha256; this is the flat-clip equivalent.
--
-- All nullable with no backfill: existing rows are untouched, and an older app
-- version serving during the migration never selects these columns.
ALTER TABLE "Clip" ADD COLUMN "sourceEtag" TEXT;
-- DOUBLE PRECISION, not INTEGER: a long recording exceeds the 2 GB that a
-- 32-bit column can hold.
ALTER TABLE "Clip" ADD COLUMN "sourceSizeBytes" DOUBLE PRECISION;
ALTER TABLE "Clip" ADD COLUMN "sourceLastModified" TIMESTAMP(3);
ALTER TABLE "Clip" ADD COLUMN "sourceVerifiedAt" TIMESTAMP(3);
