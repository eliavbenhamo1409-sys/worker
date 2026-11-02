import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_COOKIE, loginConfig, validSession } from "@/lib/login/server";

/** Sends anyone not logged in to /login. Does nothing until the login variables are set. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/login")) return NextResponse.next();

  const login = loginConfig();
  const inside = !login || validSession(login, req.cookies.get(LOGIN_COOKIE)?.value);

  if (pathname === "/login") return inside ? NextResponse.redirect(new URL("/worker", req.url)) : NextResponse.next();
  if (inside) return NextResponse.next();
  if (pathname.startsWith("/api/")) return Response.json({ error: "צריך להיכנס מחדש" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|fonts/).*)"],
};
