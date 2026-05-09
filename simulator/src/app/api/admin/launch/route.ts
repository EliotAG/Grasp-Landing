import { NextResponse } from "next/server";

import {
  SIMULATOR_ADMIN_COOKIE,
  createSimulatorAdminSession,
  verifySimulatorLaunchToken,
} from "@/lib/admin-auth";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const payload = await verifySimulatorLaunchToken(token);

  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired simulator launch token" },
      { status: 401 },
    );
  }

  const session = await createSimulatorAdminSession(payload.email);
  const redirectTo = new URL("/", url.origin);
  const response = NextResponse.redirect(redirectTo);
  response.cookies.set({
    name: SIMULATOR_ADMIN_COOKIE,
    value: session.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
