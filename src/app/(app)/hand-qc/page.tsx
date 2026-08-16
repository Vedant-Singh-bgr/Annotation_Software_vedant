import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import HandQcBoard from "./HandQcBoard";

// QC queue for ground-truth hand-tracking (.npz) files — a separate dataset
// from the video clips. Reviewers (QC / org admin / platform admin) approve or
// reject each file after inspecting its 3D skeleton.
const FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function HandQcPage({ searchParams }: Props) {
  const user = (await getSession())!;
  if (!["PLATFORM_ADMIN", "ORG_ADMIN", "QC"].includes(user.role)) redirect("/dashboard");

  const raw = (await searchParams).status?.toUpperCase();
  const status = (FILTERS as readonly string[]).includes(raw ?? "") ? raw! : "PENDING";
  const where = status === "ALL" ? {} : { reviewStatus: status };

  const [files, grouped] = await Promise.all([
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
        createdAt: true,
      },
    }),
    prisma.handFile.groupBy({ by: ["reviewStatus"], _count: true }),
  ]);

  const counts = Object.fromEntries(grouped.map((g) => [g.reviewStatus, g._count]));
  const total = grouped.reduce((n, g) => n + g._count, 0);

  return (
    <HandQcBoard
      status={status}
      counts={{ ...counts, ALL: total }}
      isAdmin={user.role === "PLATFORM_ADMIN"}
      files={files.map((f) => ({
        id: f.id,
        title: f.title,
        reviewStatus: f.reviewStatus,
        frameCount: f.frameCount,
        durationSec: f.fps > 0 ? f.frameCount / f.fps : 0,
        confirmedPct: f.confirmedPct,
        droppedFrames: f.droppedFrames,
      }))}
    />
  );
}
