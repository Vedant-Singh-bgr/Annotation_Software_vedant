"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type Props = {
  name: string;
  role: string;
  orgName: string | null;
  links: { href: string; label: string; badge?: number }[];
};

export default function TopNav({ name, role, orgName, links }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const roleLabel =
    role === "PLATFORM_ADMIN"
      ? "Platform admin"
      : role === "ORG_ADMIN"
        ? "Org admin"
        : "Annotator";

  return (
    <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/dashboard" className="font-semibold text-white">
          ▤ Annotate
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                  active
                    ? "bg-ink-700 text-white"
                    : "text-slate-300 hover:bg-ink-800"
                }`}
              >
                {l.label}
                {l.badge ? (
                  <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                    {l.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <div className="text-right leading-tight">
            <div className="text-slate-200">{name}</div>
            <div className="text-xs text-slate-500">
              {roleLabel}
              {orgName ? ` · ${orgName}` : ""}
            </div>
          </div>
          <button onClick={logout} className="btn-ghost px-2 py-1 text-xs">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
