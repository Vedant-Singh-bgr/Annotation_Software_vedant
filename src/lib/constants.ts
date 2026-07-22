// Enum-like unions. Kept as string columns in the DB so the same schema runs on
// both SQLite (zero-infra dev) and Postgres (production) — SQLite has no native
// enum type. Validation happens in the API layer.

export const ROLES = ["PLATFORM_ADMIN", "ORG_ADMIN", "ANNOTATOR"] as const;
export type Role = (typeof ROLES)[number];

export const ASSIGNMENT_STATUSES = [
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
