import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import HandQcBoard from "./HandQcBoard";

// QC queue for ground-truth hand-tracking (.npz) files — a separate dataset
// from the video clips. Reviewers (QC / org admin / platform admin) approve or
// reject each file after inspecting its 3D skeleton.
const FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;

type Props = { searchParams: Promise<{ status?: string; batch?: string }> };

export default async function HandQcPage({ searchParams }: Props) {
  const user = (await getSession())!;
  if (!["PLATFORM_ADMIN", "ORG_ADMIN", "QC"].includes(user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const raw = sp.status?.toUpperCase();
  const status = (FILTERS as readonly string[]).includes(raw ?? "") ? raw! : "PENDING";
  const batch = sp.batch && sp.batch !== "ALL" ? sp.batch : null;

  const canAssign = user.role === "PLATFORM_ADMIN" || user.role === "ORG_ADMIN";
  // A QC reviewer sees only files routed to them; admins see everything. A batch
  // filter narrows further.
  const scope = {
    ...(user.role === "QC" ? { reviewerId: user.id } : {}),
    ...(batch ? { batchId: batch } : {}),
  };
  const where = { ...scope, ...(status === "ALL" ? {} : { reviewStatus: status }) };

  const [files, grouped, reviewers, batches] = await Promise.all([
    prisma.handFile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        reviewStatus: true,
        frameCount: true,
        fps: true,
        confirmedPct: true,
        droppedFrames: true,
        reviewer: { select: { id: true, name: true } },
        batch: { select: { name: true } },
      },
    }),
    prisma.handFile.groupBy({ by: ["reviewStatus"], where: scope, _count: true }),
    canAssign
      ? prisma.user.findMany({
          where: { role: "QC", active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.handBatch.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, _count: { select: { files: true } } },
    }),
  ]);

  const counts = Object.fromEntries(grouped.map((g) => [g.reviewStatus, g._count]));
  const total = grouped.reduce((n, g) => n + g._count, 0);

  return (
    <HandQcBoard
      status={status}
      counts={{ ...counts, ALL: total }}
      isAdmin={user.role === "PLATFORM_ADMIN"}
      canAssign={canAssign}
      reviewers={reviewers}
      activeBatch={batch ?? "ALL"}
      batches={batches.map((b) => ({ id: b.id, name: b.name, fileCount: b._count.files }))}
      files={files.map((f) => ({
        id: f.id,
        title: f.title,
        reviewStatus: f.reviewStatus,
        frameCount: f.frameCount,
        durationSec: f.fps > 0 ? f.frameCount / f.fps : 0,
        confirmedPct: f.confirmedPct,
        droppedFrames: f.droppedFrames,
        reviewerId: f.reviewer?.id ?? null,
        reviewerName: f.reviewer?.name ?? null,
        batchName: f.batch?.name ?? null,
      }))}
    />
  );
}
