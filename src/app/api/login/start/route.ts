/**
 * POST /api/login/start — checks the phone and password, then has Twilio text a
 * code. Codes only ever go to the configured number.
 *
 * Body: { phone, password }. Returns { ok } or { error } in Hebrew.
 */

import type { NextRequest } from "next/server";
import { loginConfig, sameSecret, twilioVerify } from "@/lib/login/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const login = loginConfig();
  if (!login) return Response.json({ error: "הכניסה עדיין לא הוגדרה" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { phone?: unknown; password?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const phoneOk = sameSecret(phone, login.phone);
  const passwordOk = sameSecret(password, login.password);
  if (!phoneOk || !passwordOk) return Response.json({ error: "מספר או סיסמה לא נכונים" }, { status: 401 });

  const sent = await twilioVerify(login, "Verifications", { To: login.phone, Channel: "sms" });
  if (sent.httpStatus === 429) return Response.json({ error: "נשלחו יותר מדי קודים. צריך לחכות כמה דקות." }, { status: 429 });
  if (sent.state !== "pending") {
    console.error("Twilio Verify didn't send", sent.httpStatus, sent.code);
    return Response.json({ error: "הקוד לא נשלח. אפשר לנסות שוב." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
