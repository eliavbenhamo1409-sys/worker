"use client";

import { useState } from "react";
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
          <Cta label="ניסיון נוסף" busy={retrying ? "מתחבר למערכת" : null} onClick={retry} />
        </div>
      </main>
    );
  }

  if (workers.length === 0) {
    return (
      <main className="wk-home">
        <SystemBar live={state.live} />
        <EmptyState title="עדיין אין עובדים במערכת" hint="המנהל מוסיף עובדים בלוח הניהול." />
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
            <Row key={w.id} title={w.name} sub={w.role} end={null} onClick={() => choose(w.id)} />
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
      <nav className="wk-actions" aria-label="פעולות">
        <BigAction title="קיבלתי סחורה" sub="סחורה הגיעה מספק" icon="package" href="/worker/receive" />
        <BigAction title="מסרתי סחורה ללקוח" sub="סחורה יצאה ללקוח" icon="truck" href="/worker/deliver" />
        <BigAction title="דיווח על תקלה" sub="משהו נשבר, חסר או פגום" icon="alert-circle" href="/worker/fault" />
      </nav>
      {state.products.length === 0 ? <Hint title="אין עדיין מוצרים במלאי" /> : null}
      <div className="wk-who">
        <span>{worker.name}</span>
        <div className="wk-who-links">
          <button type="button" className="wk-textlink" onClick={() => choose(null)}>החלפת עובד</button>
          <ThemeSettingsButton variant="text" />
        </div>
      </div>
    </main>
  );
}
