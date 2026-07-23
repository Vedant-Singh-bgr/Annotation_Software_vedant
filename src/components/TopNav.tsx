"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

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
    <header className="sticky top-0 z-20 border-b border-ink-900/10 bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-[54px] max-w-7xl items-center px-6">
        <Link
          href="/dashboard"
          className="wordmark transition-opacity duration-300 hover:opacity-80"
        >
          Kosha
        </Link>
        <div className="mx-6 h-4 w-px bg-ink-900/10" aria-hidden="true" />
        <nav className="flex items-center gap-6">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-1.5 text-[15px] tracking-[-0.01em] transition-colors duration-200 ${
                  active
                    ? "text-ink-900 underline decoration-ink-900/30 underline-offset-4"
                    : "text-ink-700 hover:underline hover:decoration-ink-900/20 hover:underline-offset-4"
                }`}
              >
                {l.label}
                {l.badge ? (
                  <span className="rounded-full border border-accent-yellow/30 bg-accent-yellow/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-yellow">
                    {l.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-ink-800">
            {name}
            <span className="text-ink-400">
              {" · "}
              {roleLabel}
              {orgName ? ` · ${orgName}` : ""}
            </span>
          </span>
          <div className="h-4 w-px bg-ink-900/10" aria-hidden="true" />
          <ThemeToggle />
          <button
            onClick={logout}
            className="rounded text-sm text-ink-500 outline-none transition-colors duration-200 hover:text-ink-900 hover:underline hover:decoration-ink-900/25 hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
