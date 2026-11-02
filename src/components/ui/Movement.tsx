"use client";

import type { ReactNode } from "react";
import { MOVEMENT_LABEL } from "@/lib/format";

export type MovementType = keyof typeof MOVEMENT_LABEL;

export interface MovementProps {
  type?: MovementType;
  label?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Inline movement type: the Hebrew word. */
export function Movement({ type = "in", label, className, children }: MovementProps) {
  return (
    <span className={cx("sa-move", `is-${type}`, className)}>
      {children ?? label ?? MOVEMENT_LABEL[type]}
    </span>
  );
}
