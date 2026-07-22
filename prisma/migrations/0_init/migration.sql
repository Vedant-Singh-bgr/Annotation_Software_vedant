-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "r2Prefix" TEXT NOT NULL DEFAULT '',
    "sampleEveryN" INTEGER NOT NULL DEFAULT 45,
    "defaultFps" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manifestR2Key" TEXT,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "r2Key" TEXT,
    "sourceUrl" TEXT,
    "sizeBytes" INTEGER,
    "fps" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "frameCount" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,
    "sessionHash" TEXT,
    "tenantId" TEXT,
    "worksiteId" TEXT,
    "workerId" TEXT,
    "dataType" TEXT,
    "proxyR2Key" TEXT,
    "proxyStatus" TEXT NOT NULL DEFAULT 'none',
    "proxyError" TEXT,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipSegment" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "logicalPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "r2BlobKey" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "contentType" TEXT,
    "startFrame" INTEGER,
    "endFrame" INTEGER,
    "startTimeSec" DOUBLE PRECISION,
    "endTimeSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "annotatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "exportR2Key" TEXT,
    "exportedAt" TIMESTAMP(3),
    "exportError" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "startFrame" INTEGER NOT NULL,
    "endFrame" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "difficulty" TEXT NOT NULL DEFAULT '',
    "venueL2" TEXT NOT NULL DEFAULT '',
    "venueL3" TEXT NOT NULL DEFAULT '',
    "job" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION,
    "qualityFlags" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubTask" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "startFrame" INTEGER NOT NULL,
    "endFrame" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "objectLeft" TEXT NOT NULL DEFAULT '',
    "objectRight" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameQuality" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "frameIndex" INTEGER NOT NULL,
    "realWork" BOOLEAN NOT NULL DEFAULT true,
    "repetitive" BOOLEAN NOT NULL DEFAULT false,
    "occluded" BOOLEAN NOT NULL DEFAULT false,
    "smudge" BOOLEAN NOT NULL DEFAULT false,
    "glare" BOOLEAN NOT NULL DEFAULT false,
    "blur" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameQuality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomyItem" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxonomyItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE INDEX "Batch_projectId_idx" ON "Batch"("projectId");

-- CreateIndex
CREATE INDEX "Clip_batchId_idx" ON "Clip"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_batchId_r2Key_key" ON "Clip"("batchId", "r2Key");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_batchId_sessionId_key" ON "Clip"("batchId", "sessionId");

-- CreateIndex
CREATE INDEX "ClipSegment_clipId_idx" ON "ClipSegment"("clipId");

-- CreateIndex
CREATE INDEX "Assignment_annotatorId_idx" ON "Assignment"("annotatorId");

-- CreateIndex
CREATE INDEX "Assignment_clipId_idx" ON "Assignment"("clipId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_clipId_annotatorId_key" ON "Assignment"("clipId", "annotatorId");

-- CreateIndex
CREATE INDEX "Task_assignmentId_idx" ON "Task"("assignmentId");

-- CreateIndex
CREATE INDEX "SubTask_taskId_idx" ON "SubTask"("taskId");

-- CreateIndex
CREATE INDEX "FrameQuality_assignmentId_idx" ON "FrameQuality"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FrameQuality_assignmentId_frameIndex_key" ON "FrameQuality"("assignmentId", "frameIndex");

-- CreateIndex
CREATE INDEX "TaxonomyItem_type_idx" ON "TaxonomyItem"("type");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyItem_type_value_projectId_key" ON "TaxonomyItem"("type", "value", "projectId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipSegment" ADD CONSTRAINT "ClipSegment_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_annotatorId_fkey" FOREIGN KEY ("annotatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubTask" ADD CONSTRAINT "SubTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubTask" ADD CONSTRAINT "SubTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameQuality" ADD CONSTRAINT "FrameQuality_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameQuality" ADD CONSTRAINT "FrameQuality_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

