"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ThemeSettingsButton } from "@/components/ui/ThemeSettings";
import { useData } from "@/lib/store";
import { useCurrentWorker } from "@/lib/worker-store";
import { BigAction, Boot, Cta, Hint, Row, SystemBar } from "@/components/worker";

export default function WorkerHome() {
  const { state, reload } = useData();
  const { worker, workers, ready, choose } = useCurrentWorker();
  const [retrying, setRetrying] = useState(false);

  if (!ready) return <Boot />;

  if (state.status === "error") {
    const retry = async () => {
      setRetrying(true);
      await reload().catch(() => undefined);
      setRetrying(false);
    };
    return (
      <main className="wk-home">
        <SystemBar live={false} />
        <h1 className="wk-greet">אין חיבור למערכת</h1>
        <p className="wk-sub">צריך לבדוק שיש אינטרנט.</p>
        <div className="wk-stack">
          <Cta label="ניסיון נוסף" icon="refresh" busy={retrying ? "מתחבר למערכת" : null} onClick={retry} />
        </div>
      </main>
    );
  }

  if (workers.length === 0) {
    return (
      <main className="wk-home">
        <SystemBar live={state.live} />
        <EmptyState icon="user" title="עדיין אין עובדים במערכת" hint="המנהל מוסיף עובדים בלוח הניהול." />
      </main>
    );
  }

  if (!worker) {
    return (
      <main className="wk-home">
        <SystemBar live={state.live} />
        <h1 className="wk-greet">מי משתמש בטלפון?</h1>
        <p className="wk-sub">בוחרים פעם אחת, והטלפון זוכר.</p>
        <div className="wk-stack">
          {workers.map((w) => (
            <Row key={w.id} title={<><Avatar name={w.name} />{w.name}</>} sub={w.role} end={null} onClick={() => choose(w.id)} />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="wk-home">
      <SystemBar live={state.live} />
      <h1 className="wk-greet">שלום, {worker.name}</h1>
      <p className="wk-sub">מה לרשום עכשיו?</p>
      <div className="wk-stack">
        <BigAction title="קיבלתי סחורה" sub="סחורה הגיעה מספק" icon="arrow-down-left" tone="success" href="/worker/receive" />
        <BigAction title="מסרתי סחורה ללקוח" sub="סחורה יצאה ללקוח" icon="arrow-up-right" tone="accent" href="/worker/deliver" />
        <BigAction title="דיווח על תקלה" sub="משהו נשבר, חסר או פגום" icon="alert-circle" tone="neutral" href="/worker/fault" />
      </div>
      {state.products.length === 0 ? <Hint title="אין עדיין מוצרים במלאי" /> : null}
      <div className="wk-who">
        <span>מחובר בתור {worker.name}</span>
        <button type="button" className="wk-textlink" onClick={() => choose(null)}>החלפת עובד</button>
      </div>
      <ThemeSettingsButton variant="touch" />
    </main>
  );
}
