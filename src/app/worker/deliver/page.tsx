"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { cx } from "@/components/ui/cx";
import { useData } from "@/lib/store";
import { useCurrentWorker, useRecentCustomers, uploadDeliveryReceipt, DELIVERY_NOTES_BUCKET } from "@/lib/worker-store";
import type { ScannedLine } from "@/lib/worker/ocr";
import { useDocumentScan, type ReadLine } from "@/lib/worker/scan";
import { buildDictionary, matchLine, type Candidate } from "@/lib/worker/match";
import { fmtQty } from "@/lib/format";
import { Boot, CameraButton, Cta, Done, Flow, Hint, Picker, Row, Section, StepHead, Summary, pointAt, useSteps, type PickItem, type SummaryLine } from "@/components/worker";
import { Scanner, Smart } from "@/components/worker/Scanner";

type Step = "start" | "lines" | "summary" | "done";
/** `hint` is the wording read from the receipt. `candidates` are products it resembles, for the worker to confirm. `route` hands the line to the manager. */
type Line = { id: string; productId: string | null; qty: number; hint?: string; candidates?: Candidate[]; scanned?: boolean; route?: "manager" | "new"; proposedName?: string; workerNote?: string };

const ORDER: readonly Step[] = ["start", "lines", "summary", "done"];
const STEPS = [
  { key: "start", label: "לקוח" },
  { key: "lines", label: "פריטים" },
  { key: "summary", label: "אישור" },
];
const newLine = (partial: Partial<Line> = {}): Line => ({ id: Math.random().toString(36).slice(2), productId: null, qty: 1, ...partial });
const unanswered = (l: Line) => !!l.hint && !l.productId && !l.route;
const routedTitle = (l: Line) => l.proposedName ?? l.hint ?? "";
const routedSub = (l: Line) => (l.route === "new" ? "מוצר חדש, מחכה לאישור מנהל" : "הועבר למנהל לטיפול");

/** The worker asks to add a product to the warehouse dictionary; the manager approves it later. */
function AddToDictionary({ initialName, initialNote, onSubmit, onClose }: { initialName: string; initialNote: string; onSubmit: (name: string, note: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState(initialNote);
  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label="הוספה למילון המחסן">
      <div className="wk-sheet-inner">
        <StepHead title="הוספה למילון המחסן" onBack={onClose} />
        <p className="wk-sheet-lead">המנהל יאשר לפני שהכמות תרד מהמלאי.</p>
        <div className="wk-sheet-form">
          <Input id="new-product" size="touch" label="שם המוצר" required placeholder="לדוגמה: מדף אלון 28 מ״מ" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <Input size="touch" label="הערה למנהל" optional placeholder="מידה, צבע" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          <div className="wk-sheet-actions">
            <Cta label="שליחה לאישור מנהל" icon="check" onClick={() => onSubmit(name.trim(), note.trim())} blocked={name.trim() ? null : { reason: "חסר שם מוצר", onTap: () => document.getElementById("new-product")?.focus() }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DeliverPage() {
  const router = useRouter();
  const { state, issue, createItemRequest, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { recent, remember } = useRecentCustomers();
  const { step, dir, go } = useSteps(ORDER, "start");
  const { scan, start: startScan, close: closeScan } = useDocumentScan();

  const [customer, setCustomer] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  /** How many lines the last reading produced; null when nothing was read. */
  const [readCount, setReadCount] = useState<number | null>(null);
  /** Work lines read from the receipt (cutting, delivery…): recorded in the note, never deducted. */
  const [services, setServices] = useState<ScannedLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ issued: SummaryLine[]; routed: SummaryLine[] } | null>(null);
  /** Lines already saved, so retrying after a failure never issues or sends one twice. */
  const saved = useRef(new Map<string, SummaryLine>());

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const dictionary = useMemo(() => buildDictionary(state.products, state.supplierItems, state.itemRequests), [state.products, state.supplierItems, state.itemRequests]);

  /** A line read from the receipt: mapped when it's in the dictionary, otherwise the worker confirms what it resembles. */
  const scannedLine = useCallback((l: ScannedLine, suggested?: string) => {
    const m = matchLine(dictionary, l.externalName, l.externalSku);
    const candidates = m.status === "near" ? m.candidates : suggested ? [{ productId: suggested, alias: null }] : undefined;
    return newLine({ productId: m.status === "sure" ? m.productId : null, qty: Math.max(1, Math.round(l.qty)), hint: l.externalName, candidates, scanned: true });
  }, [dictionary]);

  /* ── receipt photo: preview now, OCR to prefill lines, upload when continuing ── */
  const onPhoto = useCallback((file: File | undefined) => {
    if (!file) return;
    setStoragePath(null);
    setReadCount(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
    void startScan(file, { dictionary, products: state.products });
  }, [dictionary, startScan, state.products]);

  const startUpload = useCallback(async () => {
    if (!photo || !worker || storagePath) return;
    try {
      setStoragePath(await uploadDeliveryReceipt(photo.file, worker.id));
    } catch {
      // the movement note records that the photo didn't upload; the worker carries on
    }
  }, [photo, worker, storagePath]);

  const removePhoto = () => {
    setPhoto(null);
    setReadCount(null);
    setServices([]);
    setLines((ls) => ls.filter((l) => !l.scanned).concat(ls.every((l) => l.scanned) ? [newLine()] : []));
  };

  const productItems = useMemo<PickItem[]>(
    () => state.products.map((p) => ({ id: p.id, title: p.name, sub: `${p.sku}${p.barcode ? ` · ${p.barcode}` : ""}`, keywords: `${p.sku} ${p.barcode ?? ""}`, end: <span className="sa-num">{fmtQty(p.qty)}</span> })),
    [state.products],
  );

  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  /** The worker says a scanned line is work, not goods: move it to the services list. */
  const toService = (l: Line) => {
    setServices((sv) => [...sv, { externalName: l.hint ?? product(l.productId)?.name ?? "", qty: l.qty, kind: "service" }]);
    setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.id !== l.id) : [newLine()]));
  };
  /** The worker says a service line is actually goods: move it back as a line to map. */
  const toLine = (i: number) => {
    const sv = services[i];
    setServices((list) => list.filter((_, j) => j !== i));
    setLines((ls) => [...ls.filter((x) => x.productId || x.hint), scannedLine(sv)]);
  };
  const servicesNote = services.length ? ` · עבודות: ${services.map((sv) => `${sv.externalName}${sv.qty !== 1 ? ` ×${sv.qty}` : ""}`).join(", ")}` : "";
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  const valid = lines.filter((l) => l.productId && l.qty > 0);
  const routed = lines.filter((l) => !l.productId && l.route && l.qty > 0);
  const open = lines.filter(unanswered).length;
  const name = customer.trim();

  /** Reading finished and the worker agreed: the lines land on the items step. */
  const takeReading = () => {
    if (scan.status !== "read") return;
    setServices(scan.services);
    setLines(scan.goods.length ? scan.goods.map((l) => scannedLine(l, l.suggested)) : [newLine()]);
    setReadCount(scan.goods.length + scan.services.length);
    closeScan();
    void startUpload();
    go("lines");
  };
  const fillByHand = () => {
    closeScan();
    void startUpload();
    go("lines");
  };
  const identify = (l: ReadLine) => (l.match.status === "sure" ? product(l.match.productId) : undefined);

  const submit = async () => {
    if (!worker) return;
    setBusy(true);
    setError(null);
    const photoNote = storagePath ? ` · קבלה צולמה · ${DELIVERY_NOTES_BUCKET}/${storagePath}` : photo ? " · קבלה צולמה (ההעלאה נכשלה)" : "";
    const note = `ללקוח: ${name}${photoNote}${servicesNote}`;
    setProgress(saved.current.size);
    try {
      for (const l of valid) {
        if (saved.current.has(l.id)) continue;
        const p = product(l.productId)!;
        await issue({ productId: p.id, qty: l.qty, workerId: worker.id, note });
        saved.current.set(l.id, { key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit });
        setProgress(saved.current.size);
      }
      for (const l of routed) {
        if (saved.current.has(l.id)) continue;
        await createItemRequest({
          kind: l.route === "new" ? "new_product" : "unknown", externalName: l.hint ?? routedTitle(l), proposedName: l.proposedName ?? null,
          qty: l.qty, customer: name, note, workerNote: l.workerNote ?? null, workerId: worker.id,
        });
        saved.current.set(l.id, { key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty });
        setProgress(saved.current.size);
      }
      remember(name);
      const pick = (ls: Line[]) => ls.map((l) => saved.current.get(l.id)).filter((x): x is SummaryLine => !!x);
      setResult({ issued: pick(valid), routed: pick(routed) });
      go("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return <Boot />;
  if (step === "done" && result) {
    return (
      <Done
        title={result.issued.length ? "המסירה נשמרה" : "נשלח למנהל"}
        sub={`ללקוח: ${name}`}
        note={result.routed.length ? `${result.routed.length === 1 ? "פריט אחד מחכה" : `${result.routed.length} פריטים מחכים`} למנהל` : "המלאי עודכן"}
        tone="accent"
        lines={[...result.issued, ...result.routed]}
      />
    );
  }

  const back = () => {
    if (step === "start") router.push("/worker");
    else if (step === "lines") go("start");
    else go("lines");
  };

  const pickContext = lines.find((l) => l.id === pickFor)?.hint;
  const addLine = lines.find((l) => l.id === addFor);
  const overlay = (
    <>
      {pickFor ? (
        <Picker
          title="בחירת מוצר מהמחסן"
          context={pickContext}
          items={productItems}
          placeholder="שם, מק״ט או ברקוד…"
          onPick={(id) => { patch(pickFor, { productId: id, route: undefined, proposedName: undefined, workerNote: undefined }); setPickFor(null); }}
          onClose={() => setPickFor(null)}
          emptyTitle="לא נמצא מוצר"
          extra={{ label: "לא מצאתי, להוסיף למילון המחסן", onClick: () => { setAddFor(pickFor); setPickFor(null); } }}
        />
      ) : null}
      {addFor && addLine ? (
        <AddToDictionary
          initialName={addLine.proposedName ?? addLine.hint ?? ""}
          initialNote={addLine.workerNote ?? ""}
          onClose={() => setAddFor(null)}
          onSubmit={(proposed, note) => { patch(addFor, { productId: null, route: "new", proposedName: proposed, workerNote: note || undefined, hint: addLine.hint ?? proposed }); setAddFor(null); }}
        />
      ) : null}
      <Scanner scan={scan} docName="הקבלה" unit={{ one: "שורה", many: "שורות" }} identify={identify} onContinue={takeReading} onManual={fillByHand} onRetake={onPhoto} onCancel={() => { closeScan(); setPhoto(null); }} />
    </>
  );

  if (step === "start") {
    return (
      <Flow
        flow="מסירת סחורה ללקוח"
        steps={STEPS}
        current="start"
        dir={dir}
        onBack={back}
        title="למי מסרת את הסחורה?"
        overlay={overlay}
        foot={{
          label: photo ? "המשך לפריטים" : "המשך בלי קבלה",
          iconEnd: "arrow-left",
          onClick: () => { void startUpload(); go("lines"); },
          blocked: name ? null : { reason: "חסר שם לקוח", onTap: () => pointAt("customer") },
        }}
      >
        <Section id="customer" n={1} title="שם הלקוח" need="required" done={!!name}>
          <Input size="touch" aria-label="שם הלקוח" placeholder="לדוגמה: נגריית כהן" value={customer} onChange={(e) => setCustomer(e.target.value)} autoComplete="off" />
          {recent.length ? (
            <div className="wk-chips">
              <span className="wk-chips-label">לקוחות אחרונים</span>
              {recent.map((c) => <button key={c} type="button" className={cx("wk-chip", c === name && "is-selected")} onClick={() => setCustomer(c)}>{c}</button>)}
            </div>
          ) : null}
        </Section>
        <Section id="receipt" n={2} title="צילום הקבלה" need="optional" done={!!photo} lead="המערכת תמלא את הפריטים לבד.">
          {!name ? (
            <button type="button" className="wk-photo is-locked" onClick={() => pointAt("customer")}>
              <Icon name="camera" />
              קודם שם לקוח
            </button>
          ) : photo ? (
            <>
              <div className="wk-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="תצלום הקבלה" />
                <p className="wk-shot-text" style={{ margin: 0 }}>
                  הקבלה צולמה
                  <span>{readCount === null ? "לא נקראו ממנה פריטים" : `נקראו ממנה ${readCount} שורות`}</span>
                </p>
                <button type="button" className="wk-textlink" onClick={removePhoto}>הסרה</button>
              </div>
              <CameraButton quiet label="צילום מחדש" onFile={onPhoto} />
            </>
          ) : (
            <CameraButton label="צילום הקבלה" onFile={onPhoto} />
          )}
        </Section>
      </Flow>
    );
  }

  if (step === "lines") {
    const scanned = lines.some((l) => l.scanned);
    const firstOpen = lines.find(unanswered);
    const lead = open > 0
      ? `${open === 1 ? "פריט אחד מחכה" : `${open} פריטים מחכים`} לתשובה שלך`
      : scanned ? "לבדוק מוצרים וכמויות" : "לבחור מוצר ולקבוע כמות";
    const blocked = firstOpen
      ? { reason: open === 1 ? "פריט אחד בלי תשובה" : `${open} פריטים בלי תשובה`, onTap: () => pointAt(`line-${firstOpen.id}`) }
      : valid.length + routed.length === 0 ? { reason: "לא נבחר מוצר", onTap: () => pointAt(`line-${lines[0].id}`) } : null;
    return (
      <Flow
        flow={`מסירה ל${name}`}
        steps={STEPS}
        current="lines"
        dir={dir}
        onBack={back}
        title="מה מסרת ללקוח?"
        lead={lead}
        overlay={overlay}
        foot={{ label: "המשך לאישור", iconEnd: "arrow-left", onClick: () => go("summary"), blocked }}
      >
        {state.products.length === 0 ? <Hint title="אין מוצרים במלאי" /> : null}
        <div className="wk-stack">
          {lines.map((l, i) => {
            const p = product(l.productId);
            const over = p ? l.qty > p.qty : false;
            const unknown = !p && !!l.hint;
            return (
              <article key={l.id} id={`line-${l.id}`} className={cx("wk-line", unanswered(l) && "is-open")}>
                <div className="wk-line-head">
                  <span className="wk-line-n">פריט {i + 1}</span>
                  <span className="wk-line-state">
                    {unanswered(l) ? <Badge tone="warning">צריך תשובה</Badge> : p ? <Badge tone="success">מוכן</Badge> : l.route ? <Badge tone="neutral">אצל המנהל</Badge> : null}
                  </span>
                  {lines.length > 1 ? <button type="button" className="wk-line-remove" aria-label={`הסרת פריט ${i + 1}`} onClick={() => removeLine(l.id)}><Icon name="trash" />הסרה</button> : null}
                </div>
                {unknown ? (
                  <div className="wk-receipt">
                    <span className="wk-receipt-k">{l.scanned ? <><Smart size={14} /> כתוב בקבלה</> : "פריט"}</span>
                    <span className="wk-receipt-name">{l.hint}</span>
                  </div>
                ) : (
                  <Row
                    title={p ? p.name : "בחירת מוצר"}
                    sub={p ? <><span className="sa-num">{p.sku}</span>{l.hint ? ` · בקבלה: ${l.hint}` : ""}</> : undefined}
                    selected={!!p}
                    end={<Icon name="chevron-left" size={20} />}
                    onClick={() => setPickFor(l.id)}
                  />
                )}
                {unanswered(l) ? (
                  <div className="wk-choices">
                    <p className="wk-ask">{l.candidates?.length ? "זה המוצר?" : "לא מזוהה. מה עושים?"}</p>
                    {l.candidates?.map((c) => {
                      const match = product(c.productId);
                      return match ? <Row key={c.productId} icon="check" title={match.name} sub={c.alias && c.alias !== match.name ? `במילון: ${c.alias}` : match.sku} onClick={() => patch(l.id, { productId: match.id })} /> : null;
                    })}
                    <Row icon="link" title={l.candidates?.length ? "זה מוצר אחר מהמחסן" : "יש כזה במחסן"} end={<Icon name="chevron-left" size={20} />} onClick={() => setPickFor(l.id)} />
                    <Row icon="inbox" title="לא יודע, שהמנהל יטפל" onClick={() => patch(l.id, { route: "manager" })} />
                    <Row icon="plus" title="אין כזה במחסן, להוסיף" end={<Icon name="chevron-left" size={20} />} onClick={() => setAddFor(l.id)} />
                  </div>
                ) : null}
                {!p && l.route ? (
                  <div className="wk-routed">
                    <Icon name="clock" />
                    <span className="wk-routed-text">
                      {l.route === "new" ? "יתווסף למילון המחסן אחרי אישור מנהל" : "יעבור למנהל לטיפול"}
                      {l.proposedName && l.proposedName !== l.hint ? <span className="wk-row-sub">{l.proposedName}</span> : null}
                    </span>
                    <button type="button" className="wk-textlink" onClick={() => patch(l.id, { route: undefined, proposedName: undefined, workerNote: undefined })}>שינוי</button>
                  </div>
                ) : null}
                {p ? (
                  <div className={over ? "wk-status is-warning" : "wk-status is-muted"}>
                    <Icon name={over ? "alert-circle" : "package"} />
                    <span>במלאי <span className="sa-num" style={{ fontSize: 15 }}>{fmtQty(p.qty)}</span> {p.unit}{over ? ", פחות ממה שמסרת" : ""}</span>
                  </div>
                ) : null}
                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות{p?.unit ? ` (${p.unit})` : ""}</span>
                  <QuantityStepper value={l.qty} min={1} onChange={(n) => patch(l.id, { qty: n })} />
                </div>
                {l.scanned && unanswered(l) ? <button type="button" className="wk-textlink" onClick={() => toService(l)}>זו עבודה, לא מוצר</button> : null}
              </article>
            );
          })}
          <Row quiet icon="plus" title="הוספת פריט" onClick={() => setLines((ls) => [...ls, newLine()])} />
        </div>
        {services.length ? (
          <section className="wk-stack">
            <p className="wk-ask">עבודות, לא יורד מהמלאי</p>
            {services.map((sv, i) => (
              <Row key={`${sv.externalName}-${i}`} icon="edit" title={sv.externalName} sub={sv.qty !== 1 ? `כמות: ${sv.qty}` : undefined} end={<span style={{ fontSize: 15 }}>זה מוצר?</span>} onClick={() => toLine(i)} />
            ))}
          </section>
        ) : null}
      </Flow>
    );
  }

  const issuedLines: SummaryLine[] = valid.map((l) => { const p = product(l.productId)!; return { key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit }; });
  const routedLines: SummaryLine[] = routed.map((l) => ({ key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty }));
  const anyOver = valid.some((l) => { const p = product(l.productId); return p ? l.qty > p.qty : false; });
  const total = valid.length + routed.length;
  return (
    <Flow
      flow={`מסירה ל${name}`}
      steps={STEPS}
      current="summary"
      dir={dir}
      onBack={back}
      title="בדיקה אחרונה ואישור"
      lead="עדיין לא נשמר כלום"
      overlay={overlay}
      foot={{ label: valid.length ? "אישור המסירה" : "שליחה למנהל", icon: "check", onClick: submit, busy: busy ? (total > 1 ? `שומר ${Math.min(progress + 1, total)} מתוך ${total}` : "שומר") : null }}
    >
      {error ? <Hint tone="attention" title="לא נשמר. צריך לבדוק אינטרנט וללחוץ שוב." /> : null}
      {anyOver ? <Hint tone="attention" title="כמות גדולה מהמלאי. המלאי ירד לאפס." /> : null}
      <Summary
        heading="פרטי המסירה"
        meta={[
          { k: "לקוח", v: name },
          { k: "עובד", v: worker.name },
          { k: "קבלה", v: photo ? "צולמה" : "ללא" },
          ...(services.length ? [{ k: "עבודות", v: services.map((sv) => `${sv.externalName}${sv.qty !== 1 ? ` ×${sv.qty}` : ""}`).join(", ") }] : []),
        ]}
        lines={[]}
      />
      <Summary heading="יורד מהמלאי" lines={issuedLines} />
      <Summary heading="עובר למנהל" lines={routedLines} />
    </Flow>
  );
}
