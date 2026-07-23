import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Public sample MP4s used as the "direct URL" fallback so clips play out of the
// box before R2 is wired up. Each also carries an example r2Key.
const SAMPLES = [
  {
    title: "kitchen_clip_01",
    r2Key: "clips/batch1/kitchen_clip_01.mp4",
    sourceUrl:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  },
  {
    title: "kitchen_clip_02",
    r2Key: "clips/batch1/kitchen_clip_02.mp4",
    sourceUrl:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  },
  {
    title: "kitchen_clip_03",
    r2Key: "clips/batch1/kitchen_clip_03.mp4",
    sourceUrl:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  },
];

// Appendix A placeholders (editable in-app). type -> values.
const TAXONOMY = {
  VENUE_L2: ["Hotel", "Restaurant", "Lab"],
  VENUE_L3: ["Prep Kitchen", "Dishwashing Area", "Service Bay"],
  JOB: ["Line Cook", "Housekeeper", "Lab Technician"],
};

async function main() {
  const password = await bcrypt.hash("anntt@132", 10);
  const adminPassword = await bcrypt.hash("data@321", 10);

  const platformAdmin = await prisma.user.upsert({
    where: { email: "vedant@koshalabs.ai" },
    update: {},
    create: {
      email: "vedant@koshalabs.ai",
      name: "Platform Admin",
      passwordHash: adminPassword,
      role: "PLATFORM_ADMIN",
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "labelco" },
    update: {},
    create: { name: "LabelCo", slug: "labelco" },
  });

  const orgAdmin = await prisma.user.upsert({
    where: { email: "lead@labelco.dev" },
    update: {},
    create: {
      email: "lead@labelco.dev",
      name: "Lena (LabelCo Lead)",
      passwordHash: password,
      role: "ORG_ADMIN",
      organizationId: org.id,
    },
  });

  const annotator1 = await prisma.user.upsert({
    where: { email: "ann@labelco.dev" },
    update: {},
    create: {
      email: "ann@labelco.dev",
      name: "Ann Annotator",
      passwordHash: password,
      role: "ANNOTATOR",
      organizationId: org.id,
    },
  });

  const annotator2 = await prisma.user.upsert({
    where: { email: "ravi@labelco.dev" },
    update: {},
    create: {
      email: "ravi@labelco.dev",
      name: "Ravi Annotator",
      passwordHash: password,
      role: "ANNOTATOR",
      organizationId: org.id,
    },
  });

  // Reviews only what the org admin routes to them — unlike the org admin, who
  // sees the whole org. Seeded so the QC paths ship exercised rather than
  // untested.
  const qc = await prisma.user.upsert({
    where: { email: "qc@labelco.dev" },
    update: {},
    create: {
      email: "qc@labelco.dev",
      name: "Quinn QC",
      passwordHash: password,
      role: "QC",
      organizationId: org.id,
    },
  });

  // ── Approved lists (global placeholders) ──────────────────────────────────
  await prisma.taxonomyItem.deleteMany({ where: { projectId: null } });
  for (const [type, values] of Object.entries(TAXONOMY)) {
    await prisma.taxonomyItem.createMany({
      data: values.map((value, i) => ({ type, value, sortOrder: i })),
    });
  }

  // ── Project -> Batch -> Clips (clean demo, re-created each seed) ───────────
  await prisma.project.deleteMany({
    where: { organizationId: org.id, name: "Hand-Manipulation Pilot" },
  });

  const project = await prisma.project.create({
    data: {
      name: "Hand-Manipulation Pilot",
      description: "Kosha v4 L1/L2/Q labeling.",
      organizationId: org.id,
      batches: {
        create: {
          name: "Batch 1 — kitchens",
          r2Prefix: "clips/batch1/",
          sampleEveryN: 45,
          defaultFps: 30,
        },
      },
    },
    include: { batches: true },
  });
  const batch = project.batches[0];

  const clips = [];
  for (const s of SAMPLES) {
    clips.push(
      await prisma.clip.create({
        data: {
          batchId: batch.id,
          title: s.title,
          r2Key: s.r2Key,
          sourceUrl: s.sourceUrl,
          fps: 30,
        },
      }),
    );
  }

  // ── Real MCAP-derived session clip (proxy transcoded from a ZED-X segment) ──
  // Plays public/proxy.mp4 (H.264, 1920x1200, 29.994 fps) produced by
  // scripts/transcode_session.py from a real zedx_*.mcap segment.
  const sessionClip = await prisma.clip.create({
    data: {
      batchId: batch.id,
      title: "run_20260703_160427 (zedx · monocular)",
      sourceUrl: "/proxy.mp4",
      fps: 29.994,
      frameCount: 300,
      durationSec: 10.002,
      sizeBytes: 16239840,
      sessionId: "demo-session-20260703-160427",
      sessionHash: "demo" + "0".repeat(60),
      dataType: "monocular",
      proxyStatus: "ready",
      segments: {
        create: {
          orderIndex: 0,
          logicalPath: "zedx_20260703_162510_005.mcap",
          sha256: "0".repeat(64),
          r2BlobKey: "tenants/demo/blobs/sha256/00/00/" + "0".repeat(64),
          sizeBytes: 719921403,
          contentType: "application/octet-stream",
          startFrame: 0,
          endFrame: 300,
          startTimeSec: 0,
          endTimeSec: 10.002,
        },
      },
    },
  });
  await prisma.assignment.create({
    data: { clipId: sessionClip.id, annotatorId: annotator1.id, status: "IN_PROGRESS" },
  });

  // ── Assignments ───────────────────────────────────────────────────────────
  await prisma.assignment.create({
    data: { clipId: clips[0].id, annotatorId: annotator1.id, status: "IN_PROGRESS" },
  });
  // Routed to QC, so the reviewer's queue is non-empty on a fresh seed.
  await prisma.assignment.create({
    data: {
      clipId: clips[1].id,
      annotatorId: annotator1.id,
      status: "ASSIGNED",
      reviewerId: qc.id,
    },
  });
  // Deliberately left unrouted: unrouted work stays reviewable by the org admin
  // exactly as before, and the seed should show both paths.
  await prisma.assignment.create({
    data: { clipId: clips[2].id, annotatorId: annotator2.id, status: "ASSIGNED" },
  });

  console.log("\n✅ Seed complete.\n");
  console.log("Sign in:");
  console.log(`  • Platform admin : ${platformAdmin.email}`);
  console.log(`  • Org admin       : ${orgAdmin.email}`);
  console.log(`  • QC reviewer     : ${qc.email}`);
  console.log(`  • Annotators      : ${annotator1.email}, ${annotator2.email}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
