"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Stepper } from "@/components/ui/Stepper";
import { useData } from "@/lib/store";
import { useCurrentWorker, useRecentCustomers, uploadDeliveryReceipt, DELIVERY_NOTES_BUCKET } from "@/lib/worker-store";
import { parseDeliveryNote, type ScannedLine } from "@/lib/worker/ocr";
import { buildDictionary, matchLine, suggestProducts, type Candidate } from "@/lib/worker/match";
import { fmtQty } from "@/lib/format";
import { Done, Foot, Picker, Row, StepHead, Summary, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "start" | "lines" | "summary" | "done";
/** `hint` is the wording read from the receipt. `candidates` are products it resembles, for the worker to confirm. `route` hands the line to the manager. */
type Line = { id: string; productId: string | null; qty: number; hint?: string; candidates?: Candidate[]; scanned?: boolean; route?: "manager" | "new"; proposedName?: string; workerNote?: string };

const STEPS = [
  { key: "start", label: "לקוח" },
  { key: "lines", label: "פריטים" },
  { key: "summary", label: "אישור" },
];
const newLine = (partial: Partial<Line> = {}): Line => ({ id: Math.random().toString(36).slice(2), productId: null, qty: 1, ...partial });
const unanswered = (l: Line) => !!l.hint && !l.productId && !l.route;
const routedTitle = (l: Line) => l.proposedName ?? l.hint ?? "";
const routedSub = (l: Line) => (l.route === "new" ? "מוצר חדש · מחכה לאישור מנהל" : "הועבר למנהל לטיפול");

/** The worker asks to add a product to the warehouse dictionary; the manager approves it later. */
function AddToDictionary({ initialName, initialNote, onSubmit, onClose }: { initialName: string; initialNote: string; onSubmit: (name: string, note: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState(initialNote);
  return (
    <div className="wk-sheet" role="dialog" aria-modal="true" aria-label="הוספה למילון המחסן">
      <div className="wk-sheet-inner">
        <StepHead title="הוספה למילון המחסן" onBack={onClose} />
        <Notice tone="neutral" title="המנהל יאשר את המוצר">עד האישור הוא לא נכנס למילון והכמות לא יורדת מהמלאי.</Notice>
        <Input size="touch" label="שם המוצר" required placeholder="לדוגמה: מדף אלון 28 מ״מ" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <Input size="touch" label="הערה למנהל" optional placeholder="מידה, צבע או כל מה שיעזור לזהות" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        <Button variant="primary" size="touch" icon="check" disabled={!name.trim()} onClick={() => onSubmit(name.trim(), note.trim())}>שלח לאישור מנהל</Button>
      </div>
    </div>
  );
}

export default function DeliverPage() {
  const router = useRouter();
  const { state, issue, createItemRequest, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { recent, remember } = useRecentCustomers();

  const [step, setStep] = useState<Step>("start");
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<"idle" | "ok" | "empty" | "error">("idle");
  /** Work lines read from the receipt (cutting, delivery…): recorded in the note, never deducted. */
  const [services, setServices] = useState<ScannedLine[]>([]);
  const [busy, setBusy] = useState(false);
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
  const onPhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setStoragePath(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
    setScanning(true);
    setScan("idle");
    try {
      const scanned = await parseDeliveryNote(file);
      const goods = scanned.filter((l) => l.kind !== "service");
      setServices(scanned.filter((l) => l.kind === "service"));
      if (scanned.length) {
        const unmatched = goods.filter((l) => matchLine(dictionary, l.externalName, l.externalSku).status === "none").map((l) => l.externalName);
        const suggested = await suggestProducts(unmatched, state.products, dictionary);
        setLines(goods.length ? goods.map((l) => scannedLine(l, suggested.get(l.externalName))) : [newLine()]);
        setScan("ok");
      } else setScan("empty");
    } catch {
      setScan("error");
    } finally {
      setScanning(false);
    }
  }, [dictionary, scannedLine, state.products]);

  const startUpload = useCallback(async () => {
    if (!photo || !worker || storagePath) return;
    try {
      setStoragePath(await uploadDeliveryReceipt(photo.file, worker.id));
    } catch {
      // the movement note records that the photo didn't upload; the worker carries on
    }
  }, [photo, worker, storagePath]);

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
  const canContinue = open === 0 && valid.length + routed.length > 0;

  const submit = async () => {
    if (!worker) return;
    setBusy(true);
    setError(null);
    const name = customer.trim();
    const photoNote = storagePath ? ` · קבלה צולמה · ${DELIVERY_NOTES_BUCKET}/${storagePath}` : photo ? " · קבלה צולמה (ההעלאה נכשלה)" : "";
    const note = `ללקוח: ${name}${photoNote}${servicesNote}`;
    try {
      for (const l of valid) {
        if (saved.current.has(l.id)) continue;
        const p = product(l.productId)!;
        await issue({ productId: p.id, qty: l.qty, workerId: worker.id, reference: reference.trim() || null, note });
        saved.current.set(l.id, { key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit });
      }
      for (const l of routed) {
        if (saved.current.has(l.id)) continue;
        await createItemRequest({
          kind: l.route === "new" ? "new_product" : "unknown", externalName: l.hint ?? routedTitle(l), proposedName: l.proposedName ?? null,
          qty: l.qty, customer: name, reference: reference.trim() || null, note, workerNote: l.workerNote ?? null, workerId: worker.id,
        });
        saved.current.set(l.id, { key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty });
      }
      remember(name);
      const pick = (ls: Line[]) => ls.map((l) => saved.current.get(l.id)).filter((x): x is SummaryLine => !!x);
      setResult({ issued: pick(valid), routed: pick(routed) });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return null;
  if (step === "done" && result) {
    const atManager = result.routed.length ? ` · ${result.routed.length === 1 ? "פריט אחד אצל המנהל" : `${result.routed.length} פריטים אצל המנהל`}` : "";
    return <Done title={result.issued.length ? "נמסר" : "נשלח למנהל"} sub={`ללקוח: ${customer.trim()}${atManager}`} tone="accent" lines={[...result.issued, ...result.routed]} />;
  }

  const back = () => {
    if (step === "start") router.push("/worker");
    else if (step === "lines") setStep("start");
    else setStep("lines");
  };

  if (step === "start") {
    return (
      <main className="wk-page">
        <StepHead title="מסרתי סחורה ללקוח" step={1} total={3} onBack={back} />
        <Stepper steps={STEPS} current="start" />
        <Input size="touch" label="שם הלקוח" required placeholder="לדוגמה: נגריית כהן" value={customer} onChange={(e) => setCustomer(e.target.value)} autoComplete="off" />
        {recent.length ? (
          <div className="wk-stack">
            <span className="sa-label">לקוחות אחרונים</span>
            {recent.map((c) => <Row key={c} title={c} selected={c === customer.trim()} onClick={() => setCustomer(c)} />)}
          </div>
        ) : null}
        <Input size="touch" label="מספר מסמך" optional mono inputMode="numeric" placeholder="123456" value={reference} onChange={(e) => setReference(e.target.value)} />
        <section className="wk-stack">
          <span className="sa-label">קבלה / תעודת מסירה <span className="sa-faint" style={{ fontWeight: 400 }}>אופציונלי</span></span>
          <label className="wk-photo">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} aria-label="צלם את הקבלה" />
            <Icon name="camera" />
            {photo ? "צלם שוב" : "צלם את הקבלה"}
          </label>
          {photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div className="wk-preview"><img src={photo.url} alt="תצלום הקבלה" /></div>
              <Row quiet title="הסר תמונה" onClick={() => { setPhoto(null); setScan("idle"); setServices([]); }} />
            </>
          ) : null}
          {scanning ? <Notice tone="neutral" title="קורא את הקבלה…" /> : null}
          {!scanning && scan === "ok" ? <Notice tone="success" title={`זוהו ${lines.filter((l) => l.productId || l.hint).length} פריטים${services.length ? ` ו־${services.length} עבודות` : ""}`}>בשלב הבא תאשר כל פריט.</Notice> : null}
          {!scanning && scan === "empty" ? <Notice tone="neutral" title="לא זוהו פריטים בקבלה">אפשר לבחור את הפריטים ידנית בשלב הבא.</Notice> : null}
          {!scanning && scan === "error" ? <Notice tone="warning" title="קריאת הקבלה לא עבדה">התמונה תישמר; בחר את הפריטים ידנית.</Notice> : null}
        </section>
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={!customer.trim() || scanning} onClick={() => { void startUpload(); setStep("lines"); }}>המשך לפריטים</Button>
        </Foot>
      </main>
    );
  }

  if (step === "lines") {
    return (
      <main className="wk-page">
        <StepHead title={customer.trim()} step={2} total={3} onBack={back} />
        <Stepper steps={STEPS} current="lines" />
        {state.products.length === 0 ? <Notice tone="neutral" title="אין מוצרים במלאי">מנהל יוסיף מוצרים בלוח הניהול.</Notice> : null}
        {open > 0 ? (
          <Notice tone="warning" title={open === 1 ? "פריט אחד מהקבלה לא זוהה בוודאות" : `${open} פריטים מהקבלה לא זוהו בוודאות`}>ספר לנו מה הם כדי שנוכל להמשיך.</Notice>
        ) : lines.some((l) => l.scanned) ? <Notice tone="accent" title="הפריטים נקראו מהקבלה">בדוק כל פריט ואשר את הכמויות.</Notice> : null}
        <div className="wk-stack">
          {lines.map((l, i) => {
            const p = product(l.productId);
            const over = p ? l.qty > p.qty : false;
            const unknown = !p && !!l.hint;
            return (
              <div key={l.id} className={unanswered(l) ? "wk-line is-open" : "wk-line"}>
                <div className="wk-line-head">
                  <span className="wk-line-n">#{i + 1}</span>
                  {lines.length > 1 ? <button type="button" className="wk-line-remove" aria-label="הסר שורה" onClick={() => removeLine(l.id)}><Icon name="trash" /></button> : null}
                </div>
                {unknown ? (
                  <div className="wk-receipt">
                    <span className="wk-receipt-k">{l.scanned ? "כתוב בקבלה" : "פריט"}</span>
                    <span className="wk-receipt-name">{l.hint}</span>
                  </div>
                ) : (
                  <Row
                    title={p ? p.name : "בחר מוצר"}
                    sub={p ? <><span className="sa-num">{p.sku}</span>{l.hint ? ` · בקבלה: ${l.hint}` : ""}</> : "שם, מק״ט או ברקוד"}
                    selected={!!p}
                    end={<Icon name="chevron-left" size={18} />}
                    onClick={() => setPickFor(l.id)}
                  />
                )}
                {unanswered(l) ? (
                  <div className="wk-choices">
                    <p className="wk-ask">{l.candidates?.length ? "זה המוצר?" : "איך ממשיכים עם הפריט הזה?"}</p>
                    {l.candidates?.map((c) => {
                      const match = product(c.productId);
                      return match ? <Row key={c.productId} icon="check" title={match.name} sub={c.alias && c.alias !== match.name ? `במילון: ${c.alias}` : match.sku} onClick={() => patch(l.id, { productId: match.id })} /> : null;
                    })}
                    <Row icon="link" title={l.candidates?.length ? "זה מוצר אחר מהמחסן" : "יש כזה במחסן"} sub="אבחר את המוצר מהרשימה" end={<Icon name="chevron-left" size={18} />} onClick={() => setPickFor(l.id)} />
                    <Row icon="inbox" title="לא יודע מה זה" sub="המנהל יטפל בזה" onClick={() => patch(l.id, { route: "manager" })} />
                    <Row icon="plus" title="אין כזה במחסן" sub="אוסיף אותו למילון המחסן" end={<Icon name="chevron-left" size={18} />} onClick={() => setAddFor(l.id)} />
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
                    <span>במלאי: <span className="sa-num" style={{ fontSize: 14 }}>{fmtQty(p.qty)}</span> {p.unit}{over ? " — הכמות גדולה מהמלאי" : ""}</span>
                  </div>
                ) : null}
                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות{p?.unit ? ` (${p.unit})` : ""}</span>
                  <QuantityStepper value={l.qty} min={1} onChange={(n) => patch(l.id, { qty: n })} />
                </div>
                {l.scanned && unanswered(l) ? <button type="button" className="wk-textlink" onClick={() => toService(l)}>זו עבודה כמו חיתוך או הובלה, לא מוצר</button> : null}
              </div>
            );
          })}
          <Row quiet icon="plus" title="הוסף פריט" onClick={() => setLines((ls) => [...ls, newLine()])} />
        </div>
        {services.length ? (
          <section className="wk-stack">
            <span className="sa-label">עבודות מהקבלה <span className="sa-faint" style={{ fontWeight: 400 }}>לא יורד מהמלאי</span></span>
            {services.map((sv, i) => (
              <Row key={`${sv.externalName}-${i}`} icon="edit" title={sv.externalName} sub={sv.qty !== 1 ? `×${sv.qty}` : "נרשם בהערה בלבד"} end={<span className="sa-faint" style={{ fontSize: 13 }}>זה מוצר?</span>} onClick={() => toLine(i)} />
            ))}
          </section>
        ) : null}
        <Foot>
          <Button variant="primary" size="touch" iconEnd={open ? undefined : "arrow-left"} disabled={!canContinue} onClick={() => setStep("summary")}>
            {open === 0 ? "לסיכום" : open === 1 ? "נשאר פריט אחד לסדר" : `נשארו ${open} פריטים לסדר`}
          </Button>
        </Foot>
        {pickFor ? (
          <Picker
            title="בחר מוצר מהמחסן"
            context={lines.find((l) => l.id === pickFor)?.hint}
            items={productItems}
            placeholder="שם, מק״ט או ברקוד…"
            onPick={(id) => { patch(pickFor, { productId: id, route: undefined, proposedName: undefined, workerNote: undefined }); setPickFor(null); }}
            onClose={() => setPickFor(null)}
            emptyTitle="לא נמצא מוצר"
            extra={{ label: "לא מצאתי, הוסף למילון המחסן", onClick: () => { setAddFor(pickFor); setPickFor(null); } }}
          />
        ) : null}
        {addFor ? (
          <AddToDictionary
            initialName={lines.find((l) => l.id === addFor)?.proposedName ?? lines.find((l) => l.id === addFor)?.hint ?? ""}
            initialNote={lines.find((l) => l.id === addFor)?.workerNote ?? ""}
            onClose={() => setAddFor(null)}
            onSubmit={(name, note) => { patch(addFor, { productId: null, route: "new", proposedName: name, workerNote: note || undefined, hint: lines.find((l) => l.id === addFor)?.hint ?? name }); setAddFor(null); }}
          />
        ) : null}
      </main>
    );
  }

  const summaryLines: SummaryLine[] = [
    ...valid.map((l) => { const p = product(l.productId)!; return { key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit }; }),
    ...routed.map((l) => ({ key: l.id, title: routedTitle(l), sub: routedSub(l), qty: l.qty })),
  ];
  const anyOver = valid.some((l) => { const p = product(l.productId); return p ? l.qty > p.qty : false; });
  return (
    <main className="wk-page">
      <StepHead title="אישור מסירה" step={3} total={3} onBack={back} />
      <Stepper steps={STEPS} current="summary" busy={busy} />
      {error ? <Notice tone="danger" title="השמירה נכשלה">{error}</Notice> : null}
      {anyOver ? <Notice tone="warning" title="כמות גדולה מהמלאי">המסירה תישמר בכל מקרה; המלאי ירד לאפס.</Notice> : null}
      {routed.length ? <Notice tone="neutral" title={routed.length === 1 ? "פריט אחד עובר למנהל" : `${routed.length} פריטים עוברים למנהל`}>הכמות תרד מהמלאי רק אחרי שהמנהל יאשר.</Notice> : null}
      <Summary
        meta={[
          { k: "לקוח", v: customer.trim() },
          { k: "עובד", v: worker.name },
          ...(reference.trim() ? [{ k: "מסמך", v: <span className="sa-num">{reference.trim()}</span> }] : []),
          { k: "קבלה", v: photo ? "צולמה" : "ללא" },
          ...(services.length ? [{ k: "עבודות", v: services.map((sv) => `${sv.externalName}${sv.qty !== 1 ? ` ×${sv.qty}` : ""}`).join(", ") }] : []),
        ]}
        lines={summaryLines}
      />
      <Foot>
        <Button variant="primary" size="touch" icon="check" disabled={busy} onClick={submit}>{valid.length ? "אשר מסירה" : "שלח למנהל"}</Button>
      </Foot>
    </main>
  );
}
