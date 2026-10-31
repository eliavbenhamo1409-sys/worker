import type { ReactNode } from "react";

/** Bare phone layout; pages centre themselves at var(--worker). */
export default function WorkerLayout({ children }: { children: ReactNode }) {
  return <div className="wk-root">{children}</div>;
}
