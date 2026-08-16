import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import LocalVideoOverlay from "./LocalVideoOverlay";

export default async function LocalVideoOverlayPage() {
  const user = (await getSession())!;
  if (!["PLATFORM_ADMIN", "ORG_ADMIN", "QC"].includes(user.role)) redirect("/dashboard");

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm text-ink-500">
        <Link href="/hand-qc" className="transition-colors duration-150 hover:text-ink-900">
          ← Hand QC
        </Link>
        <span className="text-ink-300">/</span>
        <span className="text-ink-700">Overlay a local video</span>
      </div>
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">
        Overlay a local video + .npz
      </h1>
      <p className="mb-5 max-w-2xl text-sm text-ink-500">
        Pick an <code>.mp4</code> and its hand-tracking <code>.npz</code> from your
        computer to see the skeleton projected onto the video — the same overlay the
        annotation workspace draws. Nothing is uploaded; it&apos;s all in your browser.
      </p>
      <LocalVideoOverlay isAdmin={user.role === "PLATFORM_ADMIN"} />
    </div>
  );
}
