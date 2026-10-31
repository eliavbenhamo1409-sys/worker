"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Stepper } from "@/components/ui/Stepper";
import { useData, normalizeName } from "@/lib/store";
import { useCurrentWorker, useRecentCustomers, uploadDeliveryReceipt, DELIVERY_NOTES_BUCKET } from "@/lib/worker-store";
import { parseDeliveryNote } from "@/lib/worker/ocr";
import { fmtQty } from "@/lib/format";
import { Done, Foot, Picker, Row, StepHead, Summary, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "start" | "lines" | "summary" | "done";
/** `hint` is the wording read from the receipt when no product matched it yet. */
type Line = { id: string; productId: string | null; qty: number; hint?: string; scanned?: boolean };

const STEPS = [
  { key: "start", label: "לקוח" },
  { key: "lines", label: "פריטים" },
  { key: "summary", label: "אישור" },
];
const newLine = (partial: Partial<Line> = {}): Line => ({ id: Math.random().toString(36).slice(2), productId: null, qty: 1, ...partial });

export default function DeliverPage() {
  const router = useRouter();
  const { state, issue, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { recent, remember } = useRecentCustomers();

  const [step, setStep] = useState<Step>("start");
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<"idle" | "ok" | "empty" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryLine[] | null>(null);

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  /** Match a line read from the receipt to a factory product by SKU, barcode or name. */
  const matchProduct = useCallback((name: string, sku: string | null | undefined) => {
    const n = normalizeName(name);
    const k = (sku ?? "").trim().toLowerCase();
    return state.products.find((p) => (k && (p.sku.toLowerCase() === k || (p.barcode ?? "").toLowerCase() === k)) || normalizeName(p.name) === n)
      ?? state.products.find((p) => n.length >= 3 && (normalizeName(p.name).includes(n) || n.includes(normalizeName(p.name))));
  }, [state.products]);

  /* ── receipt photo: preview now, OCR to prefill lines, upload when continuing ── */
  const onPhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setStoragePath(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
    setScanning(true);
    setScan("idle");
    try {
      const scanned = await parseDeliveryNote(file);
      if (scanned.length) {
        setLines(scanned.map((l) => {
          const p = matchProduct(l.externalName, l.externalSku);
          return newLine({ productId: p?.id ?? null, qty: Math.max(1, Math.round(l.qty)), hint: p ? undefined : l.externalName, scanned: true });
        }));
        setScan("ok");
      } else setScan("empty");
    } catch {
      setScan("error");
    } finally {
      setScanning(false);
    }
  }, [matchProduct]);

  const startUpload = useCallback(async () => {
    if (!photo || !worker || storagePath) return;
    try {
      setStoragePath(await uploadDeliveryReceipt(photo.file, worker.id));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    }
  }, [photo, worker, storagePath]);

  const productItems = useMemo<PickItem[]>(
    () => state.products.map((p) => ({ id: p.id, title: p.name, sub: `${p.sku}${p.barcode ? ` · ${p.barcode}` : ""}`, keywords: `${p.sku} ${p.barcode ?? ""}`, end: <span className="sa-num">{fmtQty(p.qty)}</span> })),
    [state.products],
  );

  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  const valid = lines.filter((l) => l.productId && l.qty > 0);

  const submit = async () => {
    if (!worker) return;
    setBusy(true);
    setError(null);
    const name = customer.trim();
    const photoNote = storagePath ? ` · קבלה צולמה · ${DELIVERY_NOTES_BUCKET}/${storagePath}` : photo ? " · קבלה צולמה (ההעלאה נכשלה)" : "";
    const out: SummaryLine[] = [];
    try {
      for (const l of valid) {
        const p = product(l.productId)!;
        await issue({ productId: p.id, qty: l.qty, workerId: worker.id, reference: reference.trim() || null, note: `ללקוח: ${name}${photoNote}` });
        out.push({ key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit });
      }
      remember(name);
      setResult(out);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return null;
  if (step === "done" && result) return <Done title="נמסר" sub={`ללקוח: ${customer.trim()}`} tone="accent" lines={result} />;

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
              <Row quiet title="הסר תמונה" onClick={() => { setPhoto(null); setScan("idle"); }} />
            </>
          ) : null}
          {scanning ? <Notice tone="neutral" title="קורא את הקבלה…" /> : null}
          {!scanning && scan === "ok" ? <Notice tone="success" title={`זוהו ${lines.length} פריטים`}>בשלב הבא תאשר כל פריט.</Notice> : null}
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
        {state.products.length === 0 ? <Notice tone="neutral" title="אין מוצרים במלאי">מנהל יוסיף מוצרים ב־Super Admin.</Notice> : null}
        {uploadError ? <Notice tone="warning" title="התמונה לא הועלתה" onDismiss={() => setUploadError(null)}>המסירה תישמר בלי התמונה. {uploadError}</Notice> : null}
        {lines.some((l) => l.scanned) ? <Notice tone="accent" title="הפריטים נקראו מהקבלה">בדוק כל פריט ואשר את הכמויות.</Notice> : null}
        <div className="wk-stack">
          {lines.map((l, i) => {
            const p = product(l.productId);
            const over = p ? l.qty > p.qty : false;
            return (
              <div key={l.id} className="wk-line">
                <div className="wk-line-head">
                  <span className="wk-line-n">#{i + 1}</span>
                  {lines.length > 1 ? <button type="button" className="wk-line-remove" aria-label="הסר שורה" onClick={() => removeLine(l.id)}><Icon name="trash" /></button> : null}
                </div>
                <Row
                  title={p ? p.name : l.hint ? `מהקבלה: ${l.hint}` : "בחר מוצר"}
                  sub={p ? <span className="sa-num">{p.sku}</span> : l.hint ? "לא זוהה במלאי — בחר מוצר" : "שם, מק״ט או ברקוד"}
                  selected={!!p}
                  end={<Icon name="chevron-left" size={18} />}
                  onClick={() => setPickFor(l.id)}
                />
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
              </div>
            );
          })}
          <Row quiet icon="plus" title="הוסף פריט" onClick={() => setLines((ls) => [...ls, newLine()])} />
        </div>
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={valid.length === 0} onClick={() => setStep("summary")}>לסיכום</Button>
        </Foot>
        {pickFor ? (
          <Picker title="בחר מוצר" items={productItems} placeholder="שם, מק״ט או ברקוד…" onPick={(id) => { patch(pickFor, { productId: id }); setPickFor(null); }} onClose={() => setPickFor(null)} emptyTitle="לא נמצא מוצר" />
        ) : null}
      </main>
    );
  }

  const summaryLines: SummaryLine[] = valid.map((l) => { const p = product(l.productId)!; return { key: l.id, title: p.name, sub: p.sku, qty: l.qty, unit: p.unit }; });
  const anyOver = valid.some((l) => { const p = product(l.productId); return p ? l.qty > p.qty : false; });
  return (
    <main className="wk-page">
      <StepHead title="אישור מסירה" step={3} total={3} onBack={back} />
      <Stepper steps={STEPS} current="summary" busy={busy} />
      {error ? <Notice tone="danger" title="השמירה נכשלה">{error}</Notice> : null}
      {anyOver ? <Notice tone="warning" title="כמות גדולה מהמלאי">המסירה תישמר בכל מקרה; המלאי ירד לאפס.</Notice> : null}
      <Summary
        meta={[
          { k: "לקוח", v: customer.trim() },
          { k: "עובד", v: worker.name },
          ...(reference.trim() ? [{ k: "מסמך", v: <span className="sa-num">{reference.trim()}</span> }] : []),
          { k: "קבלה", v: photo ? (storagePath ? "צולמה והועלתה" : uploadError ? "צולמה, לא הועלתה" : "מעלה…") : "ללא" },
        ]}
        lines={summaryLines}
      />
      <Foot>
        <Button variant="primary" size="touch" icon="check" disabled={busy} onClick={submit}>אשר מסירה</Button>
      </Foot>
    </main>
  );
}
