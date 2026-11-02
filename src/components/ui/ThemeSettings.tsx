"use client";

/**
 * "הגדרות" — a quiet link that opens a small dialog for light or dark appearance.
 * The choice applies at once and is saved on this device.
 *
 *   <ThemeSettingsButton variant="nav" />   → sidebar row (admin)
 *   <ThemeSettingsButton variant="text" />  → plain text link (worker)
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { THEMES, useTheme } from "@/lib/theme";
import { Button } from "./Button";
import { cx } from "./cx";

export interface ThemeSettingsButtonProps {
  variant?: "nav" | "text";
  className?: string;
}

export function ThemeSettingsButton({ variant = "nav", className }: ThemeSettingsButtonProps): ReactElement {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    // Return focus to the opener on the next frame (the dialog unmounts first).
    requestAnimationFrame(() => btnRef.current?.focus());
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx(variant === "nav" ? "sa-nav-item" : "sa-settings-link", className)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>הגדרות</span>
      </button>
      {open ? <SettingsDialog onClose={close} /> : null}
    </>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { theme, setTheme } = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const titleId = `sa-settings-${uid}-title`;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>(".sa-appearance-opt.is-active")?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])'));
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Radio-group keyboard: arrows move between the options and apply them.
  const onOptKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = (idx + 1) % THEMES.length;
    setTheme(THEMES[next].id);
    dialogRef.current?.querySelectorAll<HTMLButtonElement>(".sa-appearance-opt")[next]?.focus();
  };

  return createPortal(
    <div
      className="sa-scrim"
      style={{ position: "fixed", inset: 0, zIndex: 120 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ outline: "none", maxWidth: 400 }}
        onKeyDown={onKeyDown}
      >
        <div className="sa-modal-head">
          <h2 className="sa-modal-title" id={titleId}>הגדרות</h2>
          <Button variant="ghost" size="sm" iconOnly icon="x" aria-label="סגור" onClick={onClose} />
        </div>
        <div className="sa-modal-body">
          <div className="sa-appearance">
            <span className="sa-appearance-label">מראה</span>
            <div className="sa-appearance-opts" role="radiogroup" aria-label="מראה">
              {THEMES.map((t, i) => {
                const active = t.id === theme;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    className={cx("sa-appearance-opt", active && "is-active")}
                    onClick={() => setTheme(t.id)}
                    onKeyDown={(e) => onOptKey(e, i)}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
