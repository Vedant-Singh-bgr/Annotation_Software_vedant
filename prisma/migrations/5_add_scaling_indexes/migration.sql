-- Composite indexes for the hot filter+sort paths, so the review queue and the
-- annotator/QC dashboards stay fast as the assignment table grows. Each leading
-- column still serves single-column lookups (leftmost-prefix), so the plain FK
-- indexes are replaced rather than duplicated.
--
-- Plain (non-CONCURRENT) CREATE/DROP INDEX runs inside the migration
-- transaction and is instant on the current small table — the right time to add
-- these is now, while there is little data. If ever re-applied to a large table,
-- prefer CREATE INDEX CONCURRENTLY (run outside a transaction, by hand).

-- annotator dashboard: "my assignments, by status"
DROP INDEX "Assignment_annotatorId_idx";
CREATE INDEX "Assignment_annotatorId_status_idx" ON "Assignment"("annotatorId", "status");

-- QC dashboard / review-queue reviewer scope: routed work awaiting review
DROP INDEX "Assignment_reviewerId_idx";
CREATE INDEX "Assignment_reviewerId_status_idx" ON "Assignment"("reviewerId", "status");

-- review-queue groupBy(status) counts + the status filter (platform/org scope)
CREATE INDEX "Assignment_status_idx" ON "Assignment"("status");
