import { NextRequest, NextResponse } from "next/server";

import {
  SIMULATOR_ADMIN_COOKIE,
  verifySimulatorAdminSession,
} from "@/lib/admin-auth";

const PUBLIC_PREFIXES = [
  "/_next",
  "/favicon",
  "/access-denied",
  // Signed handoff from the authenticated Grasp app.
  "/api/admin/launch",
  // Cross-service endpoint Grasp uses to deliver bot messages. This route
  // has its own Bearer-token auth and must work without a browser cookie.
  "/api/messages",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const session = await verifySimulatorAdminSession(
    req.cookies.get(SIMULATOR_ADMIN_COOKIE)?.value,
  );
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Open the simulator from the Grasp admin dashboard." },
      { status: 401 },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/access-denied";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
