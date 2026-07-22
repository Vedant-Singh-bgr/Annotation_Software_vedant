import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";

/** Wrap a route handler so AuthError -> proper status, unknown -> 500. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api] unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message = "Not found"): never {
  throw new HttpError(404, message);
}

export function forbidden(message = "Forbidden"): never {
  throw new HttpError(403, message);
}
