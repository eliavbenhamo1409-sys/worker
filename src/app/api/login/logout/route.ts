/** POST /api/login/logout — forgets this device, so the next visit starts at /login. */

import { NextResponse } from "next/server";
import { LOGIN_COOKIE } from "@/lib/login/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(LOGIN_COOKIE);
  return res;
}
