"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { useData } from "@/lib/store";
import { useCurrentWorker, uploadFaultPhoto } from "@/lib/worker-store";
import { fmtQty } from "@/lib/format";
import { Boot, CameraButton, Done, Flow, Hint, Picker, Row, Section, Summary, pointAt, useSteps, type PickItem, type SummaryLine } from "@/components/worker";

type Step = "what" | "summary" | "done";

const ORDER: readonly Step[] = ["what", "summary", "done"];
const STEPS = [
  { key: "what", label: "מה קרה" },
  { key: "summary", label: "אישור" },
];

export default function FaultPage() {
  const router = useRouter();
  const { state, reportFault, product } = useData();
  const { worker, ready } = useCurrentWorker();
  const { step, dir, go } = useSteps(ORDER, "what");

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
  const described = description.trim().length > 0;

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
      go("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !worker) return <Boot />;

  const lines: SummaryLine[] = p && withQty ? [{ key: "q", title: p.name, sub: "ייגרע מהמלאי כפגום", qty, unit: p.unit }] : [];
  if (step === "done" && done) {
    return <Done title="הדיווח נשלח" sub={photoError ? "התמונה לא הועלתה, התקלה דווחה" : "המנהל קיבל את הדיווח"} tone="neutral" lines={lines} />;
  }

  const back = () => (step === "what" ? router.push("/worker") : go("what"));

  if (step === "what") {
    return (
      <Flow
        flow="דיווח על תקלה"
        steps={STEPS}
        current="what"
        dir={dir}
        onBack={back}
        title="מה קרה?"
        foot={{
          label: "המשך לאישור",
          iconEnd: "arrow-left",
          onClick: () => go("summary"),
          blocked: described ? null : { reason: "חסר תיאור התקלה", onTap: () => pointAt("what") },
        }}
        overlay={pick ? <Picker title="מוצר קשור" items={items} placeholder="שם, מק״ט או ברקוד…" onPick={(id) => { setProductId(id); setPick(false); }} onClose={() => setPick(false)} emptyTitle="לא נמצא מוצר" /> : null}
      >
        <Section id="what" n={1} title="תיאור התקלה" need="required" done={described}>
          <Input size="touch" multiline aria-label="תיאור התקלה" placeholder="לדוגמה: לוחות הגיעו רטובים, נשבר בזמן העמסה" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 120, paddingTop: 12, paddingBottom: 12 }} />
        </Section>
        <Section n={2} title="תמונה" need="optional" done={!!photo}>
          {photo ? (
            <>
              <div className="wk-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="תצלום התקלה" />
                <p className="wk-shot-text" style={{ margin: 0 }}>התמונה צורפה</p>
                <button type="button" className="wk-textlink" onClick={() => setPhoto(null)}>הסרה</button>
              </div>
              <CameraButton quiet label="צילום מחדש" onFile={onPhoto} />
            </>
          ) : <CameraButton quiet label="צילום התקלה" onFile={onPhoto} />}
        </Section>
        <Section n={3} title="מוצר קשור" need="optional" done={!!p}>
          <Row title={p ? p.name : "בחירת מוצר"} sub={p ? <span className="sa-num">{p.sku}</span> : undefined} selected={!!p} end={<Icon name="chevron-left" size={20} />} onClick={() => setPick(true)} />
          {p ? (
            <>
              <button type="button" className="wk-textlink" style={{ alignSelf: "flex-start", paddingInline: 0 }} onClick={() => { setProductId(null); setWithQty(false); }}>הסרת המוצר</button>
              <Row title="להוריד כמות פגומה מהמלאי?" sub={`במלאי ${fmtQty(p.qty)} ${p.unit}`} selected={withQty} icon="package" onClick={() => setWithQty((v) => !v)} />
              {withQty ? (
                <div className="wk-qty-row">
                  <span className="wk-qty-label">כמות פגומה ({p.unit})</span>
                  <QuantityStepper value={qty} min={1} onChange={setQty} />
                </div>
              ) : null}
            </>
          ) : null}
        </Section>
      </Flow>
    );
  }

  return (
    <Flow
      flow="דיווח על תקלה"
      steps={STEPS}
      current="summary"
      dir={dir}
      onBack={back}
      title="בדיקה אחרונה ושליחה"
      lead="עדיין לא נשלח כלום"
      foot={{ label: "שליחת הדיווח למנהל", icon: "check", onClick: submit, busy: busy ? "שולח את הדיווח" : null }}
    >
      {error ? <Hint tone="attention" title="לא נשלח. צריך לבדוק אינטרנט וללחוץ שוב." /> : null}
      <Summary
        heading="פרטי הדיווח"
        meta={[
          { k: "תקלה", v: <span style={{ whiteSpace: "normal" }}>{description.trim()}</span> },
          { k: "מוצר", v: p ? p.name : "ללא" },
          // eslint-disable-next-line @next/next/no-img-element
          { k: "תמונה", v: photo ? <img src={photo.url} alt="תצלום התקלה" style={{ display: "block", width: 96, height: 72, objectFit: "cover", borderRadius: 8 }} /> : "ללא" },
          { k: "עובד", v: worker.name },
        ]}
        lines={[]}
      />
      <Summary heading="יורד מהמלאי" lines={lines} />
    </Flow>
  );
}
