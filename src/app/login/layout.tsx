import type { ReactNode } from "react";

/** Bare phone layout, like /worker. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return <div className="wk-root">{children}</div>;
}
