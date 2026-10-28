"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BirthdayFields, birthdayLabel } from "../BirthdayFields";
import { useShop } from "../ShopProvider";
import { ProductArt } from "../ProductArt";
import { Icon } from "../Icons";
import { Loading } from "../Loading";
import { ReceiptView, Tracking } from "../ReceiptView";
import { api, orderApi } from "../../../lib/tova/api";
import { freqLabel, gbp } from "../../../lib/tova/shop";
import type { Receipt } from "../../../lib/tova/types";

interface Sub { id: string; product_name: string; quantity: number; interval_months: number; unit_price: number; status: string; next_charge_at: string; slug: string | null; image: string | null }
interface Order { orderNumber: string; status: string; total: number; placedAt: string; itemCount: number; stage: string; trackingNumber: string | null; carrier: string | null }

const STAGE: Record<string, [string, string]> = {
  held: ["Being checked", "paid"], paid: ["Preparing", "paid"], label: ["Preparing", "paid"], packed: ["Packed", "paid"],
  dispatched: ["On its way", "dispatched"], delivered: ["Delivered", "dispatched"], cancelled: ["Refunded", "refunded"],
};
const day = (t: string) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function BirthdayPanel() {
  const { user, store, saveBirthday, say } = useShop();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState<{ d: number | null; m: number | null }>({ d: user?.birthdayDay ?? null, m: user?.birthdayMonth ?? null });
  const [busy, setBusy] = useState(false);
  if (!user || !store) return null;
  const has = !!(user.birthdayDay && user.birthdayMonth);
  const f = store.features;
  async function save(d: number | null, m: number | null) {
    if ((d === null) !== (m === null)) { say("Choose both the day and month, or remove your birthday."); return; }
    setBusy(true);
    try { await saveBirthday(d, m); setEdit(false); say(d ? "Birthday saved" : "Birthday removed"); }
    catch (e) { say(e instanceof Error ? e.message : "Couldn't save your birthday."); }
    finally { setBusy(false); }
  }
  if (!edit) return (
    <div className="bday-row">
      <span><b>Birthday:</b> {has ? birthdayLabel(user.birthdayDay, user.birthdayMonth) : "not added"}</span>
      <button className="link" onClick={() => { setV({ d: user.birthdayDay ?? null, m: user.birthdayMonth ?? null }); setEdit(true); }}>{has ? "Change" : "Add your birthday"}</button>
      {!has && f.rewards.on && f.birthday.points > 0 && <span className="hint">Get {f.birthday.points} points on your birthday.</span>}
    </div>
  );
  return (
    <div className={`bday${busy ? " busy" : ""}`}>
      <BirthdayFields day={v.d} month={v.m} onChange={(d, m) => setV({ d, m })} idPrefix="ac-bd" />
      <p className="hint">Day and month only, no year.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={busy || !v.d || !v.m} onClick={() => save(v.d, v.m)}>Save</button>
        {has && <button className="btn ghost sm" disabled={busy} onClick={() => save(null, null)}>Remove</button>}
        <button className="btn ghost sm" disabled={busy} onClick={() => setEdit(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Delete my account: password to confirm. Personal details are erased; order records are kept for VAT. */
function DeleteAccount() {
  const { signOut, say } = useShop();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api("/profile", { method: "DELETE", json: { password: pw } });
      await signOut().catch(() => {});
      say("Your account has been deleted.");
      router.push("/");
    } catch (x) { setErr(x instanceof Error ? x.message : "Couldn't delete your account."); } finally { setBusy(false); }
  }
  return (
    <details className="acc" style={{ marginTop: 18 }} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Delete my account</summary>
      <div className="in" style={{ display: "grid", gap: 10 }}>
        <p style={{ fontSize: 14, margin: 0 }}>This deletes your name, email, phone, birthday, saved addresses, reviews, reward points and browsing history, and signs you out. It can&apos;t be undone.
          We keep the records of orders you paid for (without your name or email) because UK law requires sales and VAT records to be kept for six years.</p>
        <form onSubmit={go} className="field" style={{ gap: 10 }}>
          <label htmlFor="del-pw">Type your password to confirm</label>
          <input id="del-pw" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
          {err && <p role="alert" style={{ color: "var(--sale)", fontSize: 14, margin: 0 }}>{err}</p>}
          <div><button className="btn sm" style={{ background: "var(--sale)" }} disabled={busy || !pw}>{busy ? "Deleting…" : "Delete my account"}</button></div>
        </form>
      </div>
    </details>
  );
}

function SignIn({ next }: { next: string | null }) {
  const { store, signIn, signUp } = useShop();
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", marketing: false });
  const [bday, setBday] = useState<{ d: number | null; m: number | null }>({ d: null, m: null });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const f = store!.features;

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (mode === "in") await signIn(form.email, form.password);
      else {
        if ((bday.d === null) !== (bday.m === null)) throw new Error("Please choose both the day and month of your birthday, or leave both empty.");
        await signUp({ email: form.email, password: form.password, firstName: form.firstName, lastName: form.lastName, marketingEmail: form.marketing, birthdayDay: bday.d, birthdayMonth: bday.m });
      }
      if (next?.startsWith("/")) router.push(next);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const up = mode === "up";
  const field = (k: keyof typeof form, label: string, type = "text", auto?: string) => (
    <div className="field"><label htmlFor={`a-${k}`}>{label}</label>
      <input id={`a-${k}`} type={type} required autoComplete={auto} value={form[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })} minLength={k === "password" ? 8 : undefined} /></div>
  );
  return (
    <main className="wrap"><h1 className="page-title">Your account</h1><div className="acct">
      <form className={`panel${busy ? " busy" : ""}`} onSubmit={submit}>
        <h2>{up ? "Create an account" : "Sign in"}</h2>
        {up && <div className="fields">{field("firstName", "First name", "text", "given-name")}{field("lastName", "Last name", "text", "family-name")}</div>}
        {field("email", "Email", "email", "email")}
        {field("password", up ? "Password (8 or more characters)" : "Password", "password", up ? "new-password" : "current-password")}
        {up && f.birthday?.on && (
          <fieldset className="bday"><legend>Birthday (optional)</legend>
            <BirthdayFields day={bday.d} month={bday.m} onChange={(d, m) => setBday({ d, m })} idPrefix="su-bd" />
            <p className="hint">Day and month only, no year. {f.rewards.on && f.birthday.points ? `We'll add ${f.birthday.points} points to your account on your birthday.` : "We'll send you a birthday treat."}</p>
          </fieldset>
        )}
        {up && <label className="consent"><input type="checkbox" checked={form.marketing} onChange={(e) => setForm({ ...form, marketing: e.target.checked })} /> Email me new products and offers. Unsubscribe any time.</label>}
        {err && <p className="formerr" role="alert">{err}</p>}
        <button className="btn" type="submit" disabled={busy}>{up ? "Create my account" : "Sign in"}</button>
        <p style={{ fontSize: 14 }}>{up ? "Already have an account? " : "New here? "}<button type="button" className="link" onClick={() => { setMode(up ? "in" : "up"); setErr(null); }}>{up ? "Sign in" : "Create an account"}</button></p>
        <p style={{ fontSize: 13, color: "var(--ink-3)" }}>Your basket comes with you when you sign in.</p>
      </form>
      <div className="panel" style={{ background: "var(--surface)", border: 0 }}>
        <h2>Why join?</h2>
        {f.rewards.on ? <p><b>{f.rewards.signup} points</b> when you create an account, and {f.rewards.earn} points for every £1 after that.</p> : <p>Track orders and manage subscriptions in one place.</p>}
        <ul className="benefits">
          <li><Icon.check /><span>Track orders and download receipts</span></li>
          {f.subscribe.on && <li><Icon.check /><span>Skip, pause or cancel subscriptions</span></li>}
          <li><Icon.check /><span>Your basket, quiz result and recently viewed on every device</span></li>
          <li><Icon.check /><span>Faster checkout</span></li>
        </ul>
        {!up && <button className="btn ghost" onClick={() => setMode("up")}>Create an account</button>}
      </div>
    </div></main>
  );
}

export function Account({ next }: { next: string | null }) {
  const { store, user, userReady, cart, signOut, refreshCart, say } = useShop();
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [history, setHistory] = useState<{ delta: number; reason: string; created_at: string }[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const load = useCallback(() => {
    api<{ subscriptions: Sub[] }>("/me/subscriptions").then((r) => setSubs(r.subscriptions)).catch(() => setSubs([]));
    orderApi.mine().then((r) => setOrders(r.orders as unknown as Order[])).catch(() => setOrders([]));
    api<{ history: typeof history }>("/me/points").then((r) => setHistory(r.history)).catch(() => {});
  }, []);
  useEffect(() => { if (user) { load(); refreshCart(); } }, [user, load, refreshCart]);

  if (!store || !userReady) return <Loading />;
  if (!user) return <SignIn next={next} />;
  const f = store.features;
  const points = cart?.pointsBalance ?? 0;
  const toNext = Math.max(0, f.rewards.minRedeem - points);

  async function subAction(id: string, action: "skip" | "pause" | "resume" | "cancel") {
    if (action === "cancel" && !confirm("Cancel this subscription? You can start a new one any time.")) return;
    try {
      await api(`/me/subscriptions/${id}`, { method: "PATCH", json: { action } });
      say({ skip: "Next delivery skipped", pause: "Subscription paused", resume: "Subscription resumed", cancel: "Subscription cancelled" }[action]);
      load();
    } catch (e) { say(e instanceof Error ? e.message : "Please try again."); }
  }

  if (receipt) return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <h1 className="page-title">Receipt</h1>
      <Tracking r={receipt} />
      <ReceiptView r={receipt} vatRate={store?.delivery.vat} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0 48px" }}>
        <button className="btn ghost" onClick={() => window.print()}>Print or save as PDF</button>
        <button className="btn" onClick={() => setReceipt(null)}>Back to my account</button>
      </div>
    </main>
  );

  return (
    <main className="wrap"><h1 className="page-title">Hello, {user.firstName}</h1><div className="acct">
      {f.rewards.on && (
        <div className="panel" style={{ background: "var(--black)", color: "#fff", border: 0 }}>
          <h2 style={{ color: "#CFCBC2" }}>Your points</h2>
          <span className="big-figure num">{points}</span>
          <p style={{ color: "#D6D2C9" }}>Worth {gbp((points * f.rewards.pointValue) / 100)} off. {toNext ? `${toNext} more points and you can spend them at checkout.` : "You can spend them at checkout."}</p>
          <div className="qbar" style={{ background: "#33312D" }}><span style={{ width: `${Math.min(100, (points / f.rewards.minRedeem) * 100)}%` }} /></div>
          {history.length > 0 && (
            <details className="acc" style={{ borderColor: "#33312D" }}><summary style={{ color: "#fff" }}>Points history</summary>
              <div className="in">{history.map((h, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#D6D2C9" }}><span>{h.reason}, {day(h.created_at)}</span><b className="num" style={{ color: h.delta > 0 ? "var(--gold)" : "#fff" }}>{h.delta > 0 ? "+" : ""}{h.delta}</b></div>)}</div>
            </details>
          )}
        </div>
      )}
      {f.subscribe.on && (
        <div className="panel"><h2>Subscriptions</h2>
          {subs === null ? <p>Loading…</p> : subs.length ? subs.map((s) => (
            <div className="subrow" key={s.id}>
              <div className="im"><ProductArt slug={s.slug ?? ""} name={s.product_name} image={s.image} alt="" /></div>
              <div><b>{s.product_name}{s.quantity > 1 ? ` × ${s.quantity}` : ""}</b>
                <div style={{ fontSize: 14, color: "var(--ink-2)" }}>Every {freqLabel(s.interval_months)}, {gbp(s.unit_price * s.quantity)}. {s.status === "active" ? `Next delivery ${day(s.next_charge_at)}` : s.status === "paused" ? "Paused" : "Payment needs attention"}</div></div>
              <div className="acts">
                <button className="btn ghost sm" disabled={s.status !== "active"} onClick={() => subAction(s.id, "skip")}>Skip next</button>
                <button className="btn ghost sm" onClick={() => subAction(s.id, s.status === "active" ? "pause" : "resume")}>{s.status === "active" ? "Pause" : "Resume"}</button>
                <button className="btn ghost sm" onClick={() => subAction(s.id, "cancel")}>Cancel</button>
              </div>
            </div>
          )) : <p>No subscriptions. Choose Subscribe & Save on any product.</p>}
        </div>
      )}
      <div className="panel"><h2>Orders</h2>
        {orders === null ? <p>Loading…</p> : orders.length ? (
          <div className="tbl-wrap"><table className="t"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="r">Total</th><th /></tr></thead>
            <tbody>{orders.map((o) => {
              const [label, pill] = STAGE[o.stage] ?? [o.status, "paid"];
              return (
                <tr key={o.orderNumber}>
                  <td>{o.orderNumber}</td><td>{day(o.placedAt)}</td>
                  <td><span className={`pill ${pill}`}>{label}</span>{o.trackingNumber && ["dispatched", "delivered"].includes(o.stage) && <><br /><span className="num" style={{ fontSize: 12, color: "var(--ink-3)" }}>{o.trackingNumber}</span></>}</td>
                  <td className="r num">{gbp(Number(o.total))}</td>
                  <td><button className="btn ghost sm" onClick={async () => { try { setReceipt((await orderApi.receipt(o.orderNumber)).receipt); window.scrollTo(0, 0); } catch (e) { say(e instanceof Error ? e.message : "Couldn't load the receipt."); } }}>Receipt</button></td>
                </tr>
              );
            })}</tbody></table></div>
        ) : <p style={{ color: "var(--ink-2)" }}>Orders you place appear here. <Link href="/shop">Start shopping</Link></p>}
      </div>
      <div className="panel"><h2>Details</h2>
        <p>{user.firstName} {user.lastName}<br />{user.email}</p>
        {store.features.birthday?.on && <BirthdayPanel />}
        <p style={{ fontSize: 14, color: "var(--ink-2)" }}>To change your name or email, email {store.business.email}.</p>
        <button className="btn ghost sm" onClick={signOut}>Sign out</button>
        <DeleteAccount />
      </div>
    </div></main>
  );
}
