"use client";

/**
 * כניסה — phone with a country picker and a password, then a code by SMS.
 * Every check is on the server, in /api/login.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { Cta, Hint, Picker, SystemBar, pointAt } from "@/components/worker";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { ISRAEL, allCountries, toInternational, type Country } from "@/lib/login/countries";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

/** Null when the server said yes, otherwise what to show the worker. */
async function post(path: string, body: object): Promise<string | null> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? "משהו השתבש. אפשר לנסות שוב.";
  } catch {
    return "אין חיבור לאינטרנט";
  }
}

function CountryPicker({ onPick, onClose }: { onPick: (c: Country) => void; onClose: () => void }): ReactElement {
  const countries = useMemo(() => allCountries(), []);
  const items = useMemo(() => countries.map((c) => ({
    id: c.iso,
    title: c.name,
    keywords: `+${c.dial} ${c.dial} ${c.english} ${c.iso}`,
    end: <span className="sa-num" dir="ltr">+{c.dial}</span>,
  })), [countries]);
  return (
    <Picker
      title="בחירת מדינה"
      placeholder="שם מדינה או קידומת"
      emptyTitle="לא נמצאה מדינה"
      items={items}
      onPick={(iso) => {
        const picked = countries.find((c) => c.iso === iso);
        if (picked) onPick(picked);
      }}
      onClose={onClose}
    />
  );
}

export default function LoginPage(): ReactElement {
  const [country, setCountry] = useState<Country>(ISRAEL);
  const [picking, setPicking] = useState(false);
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phone = toInternational(country.dial, number);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = async () => {
    if (busy) return;
    setBusy("שולח קוד");
    setError(null);
    const failed = await post("/api/login/start", { phone, password });
    setBusy(null);
    if (failed) {
      setError(failed);
      return;
    }
    setCode("");
    setCodeSent(true);
    setResendIn(RESEND_SECONDS);
  };

  const checkCode = async (value: string) => {
    if (busy) return;
    setBusy("בודק את הקוד");
    setError(null);
    const failed = await post("/api/login/verify", { code: value });
    if (failed) {
      setBusy(null);
      setError(failed);
      setCode("");
      return;
    }
    window.location.replace("/worker");
  };

  const typeCode = (typed: string) => {
    const digits = typed.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void checkCode(digits);
  };

  const missing = number.replace(/\D/g, "").length < 6
    ? { reason: "חסר מספר טלפון", onTap: () => pointAt("login-phone") }
    : !password
      ? { reason: "חסרה סיסמה", onTap: () => pointAt("login-password") }
      : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (codeSent) {
      if (code.length === CODE_LENGTH) void checkCode(code);
    } else if (!missing) {
      void sendCode();
    }
  };

  if (codeSent) {
    return (
      <main className="wk-home">
        <SystemBar live />
        <h1 className="wk-greet">קוד אימות</h1>
        <p className="wk-sub">נשלח אל <span dir="ltr">{phone}</span></p>
        <form className="wk-login" onSubmit={submit}>
          <div id="login-code" className="wk-code">
            <Input
              size="touch"
              mono
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="קוד אימות"
              value={code}
              onChange={(e) => typeCode(e.target.value)}
            />
          </div>
          <div className="wk-stack">
            <Cta
              label="כניסה"
              busy={busy}
              blocked={code.length < CODE_LENGTH ? { reason: error ?? "חסר קוד", onTap: () => pointAt("login-code") } : null}
              onClick={() => void checkCode(code)}
            />
          </div>
          <div className="wk-login-links">
            <button type="button" className="wk-textlink" disabled={resendIn > 0 || !!busy} onClick={() => void sendCode()}>
              {resendIn > 0 ? <>קוד חדש בעוד <span className="sa-num">{resendIn}</span></> : "שליחת קוד חדש"}
            </button>
            <button type="button" className="wk-textlink" disabled={!!busy} onClick={() => { setCodeSent(false); setError(null); }}>שינוי מספר</button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="wk-home">
      <SystemBar live />
      <h1 className="wk-greet">כניסה</h1>
      <form className="wk-login" onSubmit={submit}>
        <div id="login-phone" className="sa-field">
          <label className="sa-label" htmlFor="login-number">מספר טלפון</label>
          <div className="wk-phone" dir="ltr">
            <button type="button" className="wk-dial" aria-label={`מדינה: ${country.name}, קידומת ${country.dial}`} onClick={() => setPicking(true)}>
              <span className="sa-num">+{country.dial}</span>
              <Icon name="chevron-down" />
            </button>
            <Input
              id="login-number"
              size="touch"
              mono
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={number}
              onChange={(e) => { setNumber(e.target.value); setError(null); }}
            />
          </div>
        </div>
        <div id="login-password" className="wk-password">
          <Input
            label="סיסמה"
            size="touch"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            end={<button type="button" className="wk-textlink" onClick={() => setShowPassword((v) => !v)}>{showPassword ? "הסתרה" : "הצגה"}</button>}
          />
        </div>
        {error ? <Hint tone="attention" title={error} /> : null}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        <div className="wk-stack">
          <Cta label="המשך" busy={busy} blocked={missing} onClick={() => void sendCode()} />
        </div>
      </form>
      {picking ? <CountryPicker onPick={(c) => { setCountry(c); setPicking(false); }} onClose={() => setPicking(false)} /> : null}
    </main>
  );
}
