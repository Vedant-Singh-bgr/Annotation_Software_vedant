import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import HandReview from "./HandReview";

type Props = { params: Promise<{ id: string }> };

export default async function HandFilePage({ params }: Props) {
  const user = (await getSession())!;
  if (!["PLATFORM_ADMIN", "ORG_ADMIN", "QC"].includes(user.role)) redirect("/dashboard");
  const { id } = await params;
  const hf = await prisma.handFile.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!hf) notFound();

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm text-ink-500">
        <Link href="/hand-qc" className="transition-colors duration-150 hover:text-ink-900">
          ← Hand QC
        </Link>
        <span className="text-ink-300">/</span>
        <span className="truncate font-mono text-ink-700">{hf.title}</span>
      </div>
      <HandReview id={hf.id} />
    </div>
  );
}
