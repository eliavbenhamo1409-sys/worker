/**
 * POST /api/login/verify — checks the texted code and, when right, keeps this
 * device logged in through an httpOnly cookie that src/proxy.ts reads.
 *
 * Body: { code }. Returns { ok } or { error } in Hebrew.
 */

import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_COOKIE, LOGIN_DAYS, issueSession, loginConfig, twilioVerify } from "@/lib/login/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const login = loginConfig();
  if (!login) return Response.json({ error: "הכניסה עדיין לא הוגדרה" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!/^\d{4,10}$/.test(code)) return Response.json({ error: "הקוד לא נכון" }, { status: 401 });

  const checked = await twilioVerify(login, "VerificationCheck", { To: login.phone, Code: code });
  if (checked.state === "approved") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(LOGIN_COOKIE, issueSession(login), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: LOGIN_DAYS * 86_400,
    });
    return res;
  }
  // Twilio deletes a verification once it expires or runs out of attempts.
  if (checked.httpStatus === 404) return Response.json({ error: "הקוד פג תוקף. צריך לשלוח קוד חדש." }, { status: 410 });
  if (checked.httpStatus === 429) return Response.json({ error: "יותר מדי ניסיונות. צריך לחכות כמה דקות." }, { status: 429 });
  if (checked.httpStatus === 0 || checked.httpStatus >= 500) return Response.json({ error: "הקוד לא נבדק. אפשר לנסות שוב." }, { status: 502 });
  return Response.json({ error: "הקוד לא נכון" }, { status: 401 });
}
