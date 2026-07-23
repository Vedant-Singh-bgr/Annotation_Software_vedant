import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Lightweight edge gate: presence + validity of the session cookie. Fine-grained
// role checks happen in server components / route handlers (which hit the DB).
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

function secretKey(): Uint8Array {
  return new TextEncoder().encode(process.env.AUTH_SECRET ?? "");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Any static file in public/ (anything with a file extension — .mp4, .html,
  // .json, .png …) serves without a session gate. API routes have no extension.
  if (/\.[a-z0-9]+$/i.test(pathname)) return NextResponse.next();

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isPublic) return NextResponse.next();

  // Machine callers: the background worker reports its results with a shared
  // secret and no session cookie. Let those specific routes through when the
  // secret matches; each handler re-validates it. The overlay report route was
  // missing here, so the worker's success/failure POSTs were 401'd at the edge
  // before reaching the handler — leaving every render stuck in "rendering".
  const secret = process.env.TRANSCODE_SECRET;
  if (
    secret &&
    req.headers.get("x-transcode-secret") === secret &&
    (/^\/api\/admin\/clips\/[^/]+\/proxy$/.test(pathname) ||
      /^\/api\/admin\/assignments\/[^/]+\/overlay$/.test(pathname) ||
      pathname === "/api/worker/claim")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("session")?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secretKey());
      valid = true;
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    // API routes get a 401; page routes redirect to login.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
