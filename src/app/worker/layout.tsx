import type { ReactNode } from "react";
import { loginConfig } from "@/lib/login/server";

/** Bare phone layout; pages centre themselves at var(--worker). `data-login` shows the logout link. */
export default function WorkerLayout({ children }: { children: ReactNode }) {
  return <div className="wk-root" data-login={loginConfig() ? "" : undefined}>{children}</div>;
}
