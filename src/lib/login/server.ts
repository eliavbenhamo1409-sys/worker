/**
 * Demo login, server side. One phone and password from the environment, and a
 * code by SMS through Twilio Verify, which creates, sends and checks the code.
 * It gates this app's screens only: the Supabase data stays open to the anon key.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const LOGIN_COOKIE = "demo_login";
export const LOGIN_DAYS = 30;

export type LoginConfig = { phone: string; password: string; accountSid: string; authToken: string; serviceSid: string };

/** Null until every variable is set, and then the app stays open as before. */
export function loginConfig(): LoginConfig | null {
  const phone = process.env.DEMO_LOGIN_PHONE?.replace(/[^\d+]/g, "");
  const password = process.env.DEMO_LOGIN_PASSWORD;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!phone || !password || !accountSid || !authToken || !serviceSid) return null;
  return { phone, password, accountSid, authToken, serviceSid };
}

/** Compares digests, so the lengths match and the time taken gives nothing away. */
export function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function signature(login: LoginConfig, expires: string): string {
  return createHmac("sha256", `${login.authToken}:${login.password}`).update(expires).digest("base64url");
}

export function issueSession(login: LoginConfig): string {
  const expires = String(Date.now() + LOGIN_DAYS * 86_400_000);
  return `${expires}.${signature(login, expires)}`;
}

export function validSession(login: LoginConfig, value: string | undefined): boolean {
  const [expires, signed] = value?.split(".") ?? [];
  if (!expires || !signed || Number(expires) < Date.now()) return false;
  return sameSecret(signed, signature(login, expires));
}

/** One call to Twilio Verify; `state` is the verification's status. Status 0 means Twilio wasn't reached. */
export async function twilioVerify(login: LoginConfig, action: "Verifications" | "VerificationCheck", params: Record<string, string>) {
  try {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${login.serviceSid}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${login.accountSid}:${login.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as { status?: unknown; code?: unknown } | null;
    return { httpStatus: res.status, state: data?.status, code: data?.code };
  } catch {
    return { httpStatus: 0, state: undefined, code: undefined };
  }
}
