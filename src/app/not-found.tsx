import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <div className="font-serif text-5xl font-medium text-ink-900">404</div>
      <p className="text-sm text-ink-500">This page or resource was not found.</p>
      <Link href="/dashboard" className="btn-primary">
        Back to dashboard
      </Link>
    </div>
  );
}
