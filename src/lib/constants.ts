// Enum-like unions. Kept as string columns in the DB so the same schema runs on
// both SQLite (zero-infra dev) and Postgres (production) — SQLite has no native
// enum type. Validation happens in the API layer.

// QC: reviews only the assignments an org admin routes to them, unlike ORG_ADMIN
// who sees the whole org. Read-only on annotations — they approve or reject with
// a note rather than editing.
export const ROLES = ["PLATFORM_ADMIN", "ORG_ADMIN", "QC", "ANNOTATOR"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// Roles an ORG_ADMIN may mint or assign within their own organisation.
// PLATFORM_ADMIN is deliberately absent — an org admin must not be able to
// create one.
export const ORG_ASSIGNABLE_ROLES = ["ANNOTATOR", "QC", "ORG_ADMIN"] as const;
export type OrgAssignableRole = (typeof ORG_ASSIGNABLE_ROLES)[number];

export function isOrgAssignableRole(value: unknown): value is OrgAssignableRole {
  return (
    typeof value === "string" && (ORG_ASSIGNABLE_ROLES as readonly string[]).includes(value)
  );
}

export const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_ADMIN: "Platform admin",
  ORG_ADMIN: "Admin",
  QC: "QC reviewer",
  ANNOTATOR: "Annotator",
};

export const ASSIGNMENT_STATUSES = [
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
