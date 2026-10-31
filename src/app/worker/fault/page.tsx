"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Stepper } from "@/components/ui/Stepper";
import { useData } from "@/lib/store";
import { useCurrentWorker, uploadFaultPhoto } from "@/lib/worker-store";
import { fmtQty } from "@/lib/format";
import { Done, Foot, Picker, Row, StepHead, Summary, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "what" | "summary" | "done";

const STEPS = [
  { key: "what", label: "מה קרה" },
  { key: "summary", label: "אישור" },
];

export default function FaultPage() {
  const router = useRouter();
  const { state, reportFault, product } = useData();
  const { worker, ready } = useCurrentWorker();

  const [step, setStep] = useState<Step>("what");
  const [productId, setProductId] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [description, setDescription] = useState("");
  const [withQty, setWithQty] = useState(false);
  const [qty, setQty] = useState(1);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (ready && !worker) router.replace("/worker");
  }, [ready, worker, router]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setPhoto((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { file, url: URL.createObjectURL(file) }; });
  };

  const items = useMemo<PickItem[]>(
    () => state.products.map((p) => ({ id: p.id, title: p.name, sub: `${p.sku}${p.barcode ? ` · ${p.barcode}` : ""}`, keywords: `${p.sku} ${p.barcode ?? ""}`, end: <span className="sa-num">{fmtQty(p.qty)}</span> })),
    [state.products],
  );
  const p = product(productId);
  const canContinue = description.trim().length > 0;

  const submit = async () => {
    if (!worker) return;
    setBusy(true);
    setError(null);
    try {
      let photoPath: string | null = null;
      if (photo) {
        try {
          photoPath = await uploadFaultPhoto(photo.file, worker.id);
        } catch (e) {
          // The report still goes through; the manager just won't get the picture.
          setPhotoError(e instanceof Error ? e.message : String(e));
        }
      }
      await reportFault({ productId: p?.id ?? null, description: description.trim(), workerId: worker.id, qty: p && withQty ? qty : null, photoPath });
      setDone(true);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return null;

  const lines: SummaryLine[] = p && withQty ? [{ key: "q", title: p.name, sub: "ייגרע מהמלאי כפגום", qty, unit: p.unit }] : [];
  if (step === "done" && done) return <Done title="דווח" sub={photo && !photoError ? "המנהל יראה את התקלה והתמונה בסקירה" : photoError ? "התקלה דווחה, אבל התמונה לא הועלתה" : "המנהל יראה את התקלה בסקירה"} tone="neutral" icon="alert-triangle" lines={lines} />;

  const back = () => (step === "what" ? router.push("/worker") : setStep("what"));

  if (step === "what") {
    return (
      <main className="wk-page">
        <StepHead title="דיווח על תקלה" step={1} total={2} onBack={back} />
        <Stepper steps={STEPS} current="what" />
        <Input size="touch" multiline label="מה קרה?" required placeholder="לדוגמה: לוחות הגיעו רטובים / נשבר בזמן העמסה" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 112, paddingTop: 12, paddingBottom: 12 }} />
        <section className="wk-stack">
          <span className="sa-label">תמונה <span className="sa-faint" style={{ fontWeight: 400 }}>אופציונלי</span></span>
          <label className="wk-photo">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} aria-label="צלם את התקלה" />
            <Icon name="camera" />
            {photo ? "צלם שוב" : "צלם את התקלה"}
          </label>
          {photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div className="wk-preview"><img src={photo.url} alt="תצלום התקלה" /></div>
              <Row quiet title="הסר תמונה" onClick={() => setPhoto(null)} />
            </>
          ) : null}
        </section>
        <section className="wk-stack">
          <span className="sa-label">מוצר קשור <span className="sa-faint" style={{ fontWeight: 400 }}>אופציונלי</span></span>
          <Row title={p ? p.name : "בחר מוצר"} sub={p ? <span className="sa-num">{p.sku}</span> : "אם התקלה קשורה לפריט במלאי"} selected={!!p} end={<Icon name="chevron-left" size={18} />} onClick={() => setPick(true)} />
          {p ? <Row quiet title="הסר מוצר" onClick={() => { setProductId(null); setWithQty(false); }} /> : null}
        </section>
        {p ? (
          <section className="wk-stack">
            <Row title="יש כמות פגומה לגרוע מהמלאי?" sub={`במלאי: ${fmtQty(p.qty)} ${p.unit}`} selected={withQty} icon="package" onClick={() => setWithQty((v) => !v)} />
            {withQty ? (
              <div className="wk-qty-row" style={{ paddingInline: 4 }}>
                <span className="wk-qty-label">כמות פגומה ({p.unit})</span>
                <QuantityStepper value={qty} min={1} onChange={setQty} />
              </div>
            ) : null}
          </section>
        ) : null}
        <Foot>
          <Button variant="primary" size="touch" iconEnd="arrow-left" disabled={!canContinue} onClick={() => setStep("summary")}>לסיכום</Button>
        </Foot>
        {pick ? <Picker title="מוצר קשור" items={items} placeholder="שם, מק״ט או ברקוד…" onPick={(id) => { setProductId(id); setPick(false); }} onClose={() => setPick(false)} emptyTitle="לא נמצא מוצר" /> : null}
      </main>
    );
  }

  return (
    <main className="wk-page">
      <StepHead title="אישור דיווח" step={2} total={2} onBack={back} />
      <Stepper steps={STEPS} current="summary" busy={busy} />
      {error ? <Notice tone="danger" title="השמירה נכשלה">{error}</Notice> : null}
      <Summary
        meta={[
          { k: "תקלה", v: <span style={{ whiteSpace: "normal" }}>{description.trim()}</span> },
          { k: "מוצר", v: p ? p.name : "ללא" },
          // eslint-disable-next-line @next/next/no-img-element
          { k: "תמונה", v: photo ? <img src={photo.url} alt="תצלום התקלה" style={{ display: "block", width: 96, height: 72, objectFit: "cover", borderRadius: 8 }} /> : "ללא" },
          { k: "עובד", v: worker.name },
        ]}
        lines={lines}
      />
      <Foot>
        <Button variant="danger" size="touch" icon="alert-triangle" disabled={busy} onClick={submit}>שלח דיווח</Button>
      </Foot>
    </main>
  );
}
