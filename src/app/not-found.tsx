import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <div className="text-4xl font-bold text-white">404</div>
      <p className="text-slate-400">This page or resource was not found.</p>
      <Link href="/dashboard" className="btn-primary">
        Back to dashboard
      </Link>
    </div>
  );
}
