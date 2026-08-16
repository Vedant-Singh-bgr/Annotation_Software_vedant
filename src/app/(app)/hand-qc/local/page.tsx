import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import LocalHandPreview from "./LocalHandPreview";

export default async function LocalHandPreviewPage() {
  const user = (await getSession())!;
  if (!["PLATFORM_ADMIN", "ORG_ADMIN", "QC"].includes(user.role)) redirect("/dashboard");

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm text-ink-500">
        <Link href="/hand-qc" className="transition-colors duration-150 hover:text-ink-900">
          ← Hand QC
        </Link>
        <span className="text-ink-300">/</span>
        <span className="text-ink-700">Preview a local file</span>
      </div>
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">Load a local .npz</h1>
      <p className="mb-5 max-w-2xl text-sm text-ink-500">
        Load a hand-tracking file straight from your computer to inspect the 3D
        skeleton — the preview is parsed in your browser and stays on your machine.
        {user.role === "PLATFORM_ADMIN"
          ? " Then add it to the QC queue to approve or reject it."
          : ""}
      </p>
      <LocalHandPreview isAdmin={user.role === "PLATFORM_ADMIN"} />
    </div>
  );
}
