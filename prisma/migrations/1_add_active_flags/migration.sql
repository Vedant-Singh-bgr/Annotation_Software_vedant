-- Soft-deactivate flags for users and organizations.
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
