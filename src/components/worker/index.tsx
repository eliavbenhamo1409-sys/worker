"use client";

import Link, { useLinkStatus } from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName, type Tone } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Mark } from "@/components/ui/Mark";
import { EmptyState } from "@/components/ui/EmptyState";
import { cx } from "@/components/ui/cx";
import { fmtQty } from "@/lib/format";
import "./worker.css";

/* ── Thinking: the one sign that the system is working ───────── */
export function ThinkingMark(): ReactElement {
  return <span className="wk-think" aria-hidden="true"><i /><i /><i /></span>;
}

/** Stays out of the way on a good connection; speaks up when an answer is taking long. */
export function useTakingLong(active: boolean, ms = 6000): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setLong(true), ms);
    return () => {
      clearTimeout(t);
      setLong(false);
    };
  }, [active, ms]);
  return long;
}

export function Thinking({ label, longLabel = "עוד רגע" }: { label: string; longLabel?: string }): ReactElement {
  const long = useTakingLong(true);
  return (
    <span className="wk-thinking" role="status">
      <ThinkingMark />
      <span>{long ? longLabel : label}</span>
    </span>
  );
}

/** Full screen while data or a screen is loading, so the app is never just blank. */
export function Boot({ label = "טוען את המערכת" }: { label?: string }): ReactElement {
  return (
    <main className="wk-boot">
      <span className="wk-sys-mark" aria-hidden="true">מ</span>
      <Thinking label={label} />
    </main>
  );
}

/* ── System bar: the top of the home screen ──────────────────── */
export function SystemBar({ live }: { live: boolean }): ReactElement {
  return (
    <header className="wk-sys">
      <span className="wk-sys-mark" aria-hidden="true">מ</span>
      <span className="wk-sys-name">ניהול מלאי</span>
      <span className={cx("wk-live", live && "is-live")}>
        <span className="wk-live-dot" aria-hidden="true" />
        {live ? "מחובר" : "מתחבר"}
      </span>
    </header>
  );
}

/* ── BigAction: the home buttons ─────────────────────────────── */
function BigActionEnd(): ReactElement {
  const { pending } = useLinkStatus();
  return pending ? <ThinkingMark /> : <Icon name="chevron-left" className="sa-bigaction-chev" />;
}

export function BigAction({ title, sub, icon, tone, href }: { title: string; sub?: string; icon: IconName; tone: Tone; href: string }): ReactElement {
  return (
    <Link href={href} className="sa-bigaction">
      <Mark tone={tone} icon={icon} size="lg" />
      <span className="sa-bigaction-body">
        <span className="sa-bigaction-title" style={{ display: "block" }}>{title}</span>
        {sub ? <span className="sa-bigaction-sub" style={{ display: "block" }}>{sub}</span> : null}
      </span>
      <BigActionEnd />
    </Link>
  );
}

/* ── Flow: the frame of every process ────────────────────────── */
export type FlowStep = { key: string; label: string };

/** Which step the flow is on, and which way it last moved, for the entrance direction. */
export function useSteps<T extends string>(order: readonly T[], first: T) {
  const [state, setState] = useState<{ step: T; dir: "forward" | "back" }>({ step: first, dir: "forward" });
  const go = useCallback((step: T) => {
    setState((s) => ({ step, dir: order.indexOf(step) < order.indexOf(s.step) ? "back" : "forward" }));
  }, [order]);
  return { step: state.step, dir: state.dir, go };
}

/** Takes the worker to what is holding them back: scrolls there and gives it a soft pulse. */
export function pointAt(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  el.removeAttribute("data-pointed");
  void el.offsetWidth;
  el.setAttribute("data-pointed", "");
  el.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  window.setTimeout(() => el.removeAttribute("data-pointed"), 1400);
}

export type CtaProps = {
  label: string;
  onClick: () => void;
  /** Why the worker can't go on yet. The button stays pressable and shows them where. */
  blocked?: { reason: string; onTap: () => void } | null;
  /** While set, the system is working and this says on what. */
  busy?: string | null;
  icon?: IconName;
  iconEnd?: IconName;
};

/** The one next step: its button, and in plain words why it isn't available yet. */
export function Cta({ label, onClick, blocked, busy, icon, iconEnd }: CtaProps): ReactElement {
  const stuck = blocked && !busy ? blocked : null;
  return (
    <>
      <p className={cx("wk-why", stuck && "is-on")} role="status">
        {stuck ? <><span className="wk-why-mark" aria-hidden="true" />{stuck.reason}</> : null}
      </p>
      <Button
        variant="primary"
        size="touch"
        icon={busy || stuck ? undefined : icon}
        iconEnd={busy || stuck ? undefined : iconEnd}
        disabled={!!busy}
        aria-busy={busy ? true : undefined}
        aria-disabled={stuck ? true : undefined}
        className={cx("wk-cta", stuck && "is-blocked", busy && "is-busy")}
        onClick={stuck ? stuck.onTap : onClick}
      >
        {busy ? <Thinking label={busy} /> : label}
      </Button>
    </>
  );
}

export function Flow({ flow, steps, current, dir, title, lead, onBack, foot, overlay, children }: {
  /** The process this is, shown above the title. */
  flow: string;
  steps: FlowStep[];
  current: string;
  dir: "forward" | "back";
  /** What the worker is doing right now. */
  title: string;
  /** What the system expects from them on this step, when the title doesn't already say it. */
  lead?: ReactNode;
  onBack: () => void;
  foot: CtaProps;
  overlay?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const router = useRouter();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const index = steps.findIndex((s) => s.key === current);

  useEffect(() => { router.prefetch("/worker"); }, [router]);
  useEffect(() => {
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, [current]);

  return (
    <>
      <div className="wk-bar">
        <div className="wk-bar-top">
          <button type="button" className="wk-back" onClick={onBack}>
            <Icon name="arrow-right" />
            <span>חזרה</span>
          </button>
          <span className="wk-step">שלב {index + 1} מתוך {steps.length}</span>
        </div>
        <ol className="wk-progress" aria-label={`התקדמות: שלב ${index + 1} מתוך ${steps.length}`}>
          {steps.map((s, i) => (
            <li key={s.key} className={cx("wk-progress-step", i < index && "is-done", i === index && "is-active")} aria-current={i === index ? "step" : undefined}>
              <span className="wk-progress-line" aria-hidden="true" />
              <span className="wk-progress-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
      <main key={current} className="wk-page" data-dir={dir}>
        <header className="wk-intro">
          <p className="wk-eyebrow">{flow}</p>
          <h1 ref={titleRef} tabIndex={-1} className="wk-title">{title}</h1>
          {lead ? <p className="wk-lead">{lead}</p> : null}
        </header>
        {children}
      </main>
      <div className="wk-foot"><div><Cta {...foot} /></div></div>
      {overlay}
    </>
  );
}

/* ── Section: one thing to do on a step ──────────────────────── */
export function Section({ id, n, title, lead, need, done, children }: {
  id?: string;
  n: number;
  title: string;
  /** Why this is asked, or what happens with it. */
  lead?: ReactNode;
  need: "required" | "optional";
  done?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className={cx("wk-section", done && "is-done")}>
      <header className="wk-section-head">
        <span className="wk-section-n" aria-hidden="true">{done ? <Icon name="check" size={16} strokeWidth={3} /> : n}</span>
        <div className="wk-section-text">
          <div className="wk-section-titles">
            <h2 className="wk-section-title">{title}</h2>
            <span className={cx("wk-need", need === "required" && "is-required")}>{need === "required" ? "חובה" : "לא חובה"}</span>
          </div>
          {lead ? <p className="wk-section-lead">{lead}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

/* ── Hint: a quiet message, a word plus a small colour accent ── */
export function Hint({ tone = "info", title, children }: { tone?: "info" | "attention" | "success"; title: ReactNode; children?: ReactNode }): ReactElement {
  return (
    <div className={cx("wk-hint", `is-${tone}`)} role="status">
      <span className="wk-hint-mark" aria-hidden="true" />
      <div className="wk-hint-body">
        <p className="wk-hint-title">{title}</p>
        {children ? <p className="wk-hint-text">{children}</p> : null}
      </div>
    </div>
  );
}

/* ── Sheet header with back arrow ────────────────────────────── */
export function StepHead({ title, onBack }: { title: string; onBack: () => void }): ReactElement {
  return (
    <header className="wk-head">
      <button type="button" className="wk-back" onClick={onBack}>
        <Icon name="arrow-right" />
        <span>חזרה</span>
      </button>
      <h1 className="wk-head-title">{title}</h1>
    </header>
  );
}

/* ── Camera button ───────────────────────────────────────────── */
export function CameraButton({ label, onFile, quiet }: { label: string; onFile: (file: File | undefined) => void; quiet?: boolean }): ReactElement {
  return (
    <label className={cx("wk-photo", quiet && "is-quiet")}>
      <input type="file" accept="image/*" capture="environment" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} aria-label={label} />
      <Icon name="camera" />
      {label}
    </label>
  );
}

/* ── Tall choice row ─────────────────────────────────────────── */
export function Row({ title, sub, end, selected, quiet, onClick, icon, badge }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; selected?: boolean; quiet?: boolean; icon?: IconName; badge?: string; onClick: () => void }): ReactElement {
  return (
    <button type="button" className={cx("wk-row", selected && "is-selected", quiet && "is-quiet")} onClick={onClick}>
      {icon ? <Icon name={icon} size={20} /> : null}
      <span className="wk-row-body">
        <span className="wk-row-title">{title}{badge ? <Badge tone="accent">{badge}</Badge> : null}</span>
        {sub ? <span className="wk-row-sub">{sub}</span> : null}
      </span>
      {end !== undefined ? <span className="wk-row-end">{end}</span> : selected ? <Icon name="check" size={20} className="wk-row-end" /> : null}
    </button>
  );
}

/* ── Full-screen searchable picker ───────────────────────────── */
export type PickItem = { id: string; title: string; sub?: string; keywords?: string; end?: ReactNode };

export function Picker({ title, lead, context, items, onPick, onClose, placeholder = "חיפוש…", extra, emptyTitle = "אין פריטים", emptyHint }: {
  title: string;
  /** What to do on this screen. */
  lead?: string;
  /** What the worker is looking for, e.g. the wording on the receipt. */
  context?: string;
  items: PickItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  /** An extra quiet row at the end, e.g. "לא יודע". */
  extra?: { label: string; onClick: () => void };
  emptyTitle?: string;
  emptyHint?: string;
}): ReactElement {
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((it) => `${it.title} ${it.sub ?? ""} ${it.keywords ?? ""}`.toLowerCase().includes(n));
  }, [items, q]);
  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wk-sheet-inner">
        <StepHead title={title} onBack={onClose} />
        {lead ? <p className="wk-sheet-lead">{lead}</p> : null}
        {context ? <p className="wk-pick-context">כתוב במסמך: <strong>{context}</strong></p> : null}
        <Input size="touch" icon="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} autoComplete="off" />
        <div className="wk-sheet-list">
          {filtered.length === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : filtered.map((it) => <Row key={it.id} title={it.title} sub={it.sub} end={it.end} onClick={() => onPick(it.id)} />)}
          {extra ? <Row quiet title={extra.label} onClick={extra.onClick} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ── Summary list ────────────────────────────────────────────── */
export type SummaryLine = { key: string; title: string; sub?: string; qty: number; unit?: string };

export function Summary({ heading, meta = [], lines }: { heading?: string; meta?: { k: string; v: ReactNode }[]; lines: SummaryLine[] }): ReactElement | null {
  if (!meta.length && !lines.length) return null;
  return (
    <div className="wk-sum">
      {heading ? <p className="wk-sum-heading">{heading}</p> : null}
      {meta.map((m) => (
        <div key={m.k} className="wk-sum-row">
          <span className="wk-sum-k">{m.k}</span>
          <span className="wk-sum-v">{m.v}</span>
        </div>
      ))}
      {lines.map((l) => (
        <div key={l.key} className="wk-sum-row">
          <span className="wk-sum-v">
            {l.title}
            {l.sub ? <span className="wk-sum-sub">{l.sub}</span> : null}
          </span>
          <span className="wk-sum-qty">{fmtQty(l.qty)}{l.unit ? <span className="wk-sum-unit">{l.unit}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

const RETURN_MS = 8000;

/* ── Full-screen confirmation, returns home on its own ───────── */
export function Done({ title, sub, note, lines, tone = "success" }: { title: string; sub?: string; /** What happens next. */ note?: string; lines: SummaryLine[]; tone?: Tone }): ReactElement {
  const router = useRouter();
  useEffect(() => {
    router.prefetch("/worker");
    const t = setTimeout(() => router.replace("/worker"), RETURN_MS);
    return () => clearTimeout(t);
  }, [router]);
  const bg = tone === "success" ? "var(--success)" : tone === "accent" ? "var(--accent)" : "var(--bg-inverse)";
  const on = tone === "success" ? "var(--on-success)" : tone === "accent" ? "var(--on-accent)" : "var(--text-inverse)";
  return (
    <div className="wk-done" role="status" aria-live="polite">
      <div className="wk-done-inner">
        <span className="wk-done-mark" style={{ background: bg, color: on }}><Icon name="check" strokeWidth={3} /></span>
        <h1 className="wk-done-title">{title}</h1>
        {sub ? <p className="wk-done-sub">{sub}</p> : null}
        {note ? <p className="wk-done-note">{note}</p> : null}
        <Summary lines={lines} />
        <Button variant="primary" size="touch" onClick={() => router.replace("/worker")}>חזרה למסך הראשי</Button>
        <div className="wk-done-bar" aria-hidden="true"><span style={{ animationDuration: `${RETURN_MS}ms` }} /></div>
      </div>
    </div>
  );
}
