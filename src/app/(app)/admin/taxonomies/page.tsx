import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TAXONOMY_TYPES } from "@/lib/kosha";
import TaxonomyManager from "./TaxonomyManager";

export default async function TaxonomiesPage() {
  const user = (await getSession())!;
  if (user.role !== "PLATFORM_ADMIN") redirect("/dashboard");

  const items = await prisma.taxonomyItem.findMany({
    where: { projectId: null },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
  });

  const grouped = Object.fromEntries(
    TAXONOMY_TYPES.map((t) => [
      t,
      items
        .filter((i) => i.type === t)
        .map((i) => ({ id: i.id, value: i.value, active: i.active })),
    ]),
  );

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">Approved lists</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-500">
        Appendix A of the guideline. Annotators select venue and job values from
        these lists only — they cannot free-type. Seeded with placeholders; edit
        them to your final approved values before a batch ships.
      </p>
      <TaxonomyManager grouped={grouped} />
    </div>
  );
}
