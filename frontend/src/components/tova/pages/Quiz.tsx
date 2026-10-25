"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useShop } from "../ShopProvider";
import { ProductArt } from "../ProductArt";
import { Loading } from "../Loading";
import { gbp, round2, shopHref } from "../../../lib/tova/shop";
import type { Product, QuizQuestion } from "../../../lib/tova/types";

type Answers = Record<string, string[]>;
const has = (a: Answers, q: string, o: string) => (a[q] ?? []).includes(o);
const shown = (q: QuizQuestion, a: Answers) => {
  if (!q.showIf?.q) return true;
  const yes = has(a, q.showIf.q, q.showIf.o);
  return q.showIf.op === "not" ? !yes : yes;
};

/** Answers are remembered on this device (and on the account when signed in), so the quiz survives a refresh or a return visit. */
export function Quiz({ showResult }: { showResult: boolean }) {
  const { store, bySlug, quiz, setQuiz, addQuizSet, cartBusy, track } = useShop();
  useEffect(() => {
    if (showResult && quiz.productSlugs?.length) setQuiz({ ...quiz, step: 999 });
  }, [showResult]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!store) return <Loading />;
  const f = store.features;
  if (!f.quiz.on || !store.quiz.length) return (
    <main className="wrap"><div className="empty" style={{ marginTop: 40 }}><b>The vitamin finder is resting</b><p>Browse the range or ask us at info@tova-ster.com.</p><Link className="btn sm" href="/shop">Shop all products</Link></div></main>
  );

  const a = quiz.answers;
  const steps = store.quiz.filter((q) => q.on && q.opts.length && shown(q, a));
  const i = Math.min(quiz.step, steps.length);

  const reset = () => { setQuiz({ answers: {}, step: 0 }); track("quiz", "Restarted the quiz"); };

  if (i >= steps.length) {
    const recs: { p: Product; why: string }[] = [];
    let gp = false;
    for (const q of steps) for (const o of q.opts) {
      if (!has(a, q.id, o.id)) continue;
      if (o.gp) gp = true;
      const p = o.productSlug ? bySlug.get(o.productSlug) : undefined;
      if (p && p.inStock && !recs.find((r) => r.p.id === p.id)) recs.push({ p, why: o.why || p.benefits[0] || p.short_description || "" });
    }
    const top = recs.slice(0, Math.max(1, f.quiz.max));
    if (!top.length) return (
      <main className="wrap"><div className="quiz"><div className="qbar"><span style={{ width: "100%" }} /></div>
        <h1>We don&apos;t have a suggestion for those answers</h1>
        {gp && <div className="notice warn">As you&apos;re pregnant, breastfeeding or taking medication, please check with your GP or pharmacist before starting any supplement.</div>}
        <p style={{ color: "var(--ink-2)" }}>Have a look at our best sellers, or start again with different answers.</p>
        <div className="qnav"><button className="btn ghost" onClick={reset}>Start again</button><Link className="btn" href={shopHref({ sort: "best" })}>See best sellers</Link></div>
      </div></main>
    );
    const base = round2(top.reduce((s, r) => s + r.p.price, 0));
    const price = round2(base * (1 - f.quiz.discount / 100));
    return (
      <main className="wrap"><div className="quiz"><div className="qbar"><span style={{ width: "100%" }} /></div>
        <h1>Your suggested set</h1>
        {gp && <div className="notice warn">As you&apos;re pregnant, breastfeeding or taking medication, please check with your GP or pharmacist before starting any of these.</div>}
        <div className="result">{top.map(({ p, why }) => (
          <div className="rec" key={p.id}>
            <div className="im"><ProductArt slug={p.slug} name={p.name} image={p.images[0]?.url} alt="" /></div>
            <div><b>{p.name}</b><p>{why}</p><p className="num" style={{ color: "var(--ink)" }}>{gbp(p.price)}</p></div>
            <Link className="btn ghost sm" href={`/products/${p.slug}`}>View</Link>
          </div>
        ))}</div>
        <div className="band" style={{ background: "var(--surface)", padding: 28 }}>
          <div><h2 style={{ fontSize: 28 }}>{top.length === 1 ? "Get it" : `Take all ${top.length}`}{f.quiz.discount && top.length > 1 ? ` and save ${f.quiz.discount}%` : ""}</h2>
            <p className="num"><span className="price" style={{ fontSize: 22 }}>{gbp(top.length > 1 ? price : base)}</span> {f.quiz.discount > 0 && top.length > 1 && <span className="was">{gbp(base)}</span>}</p></div>
          <div className="actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn" disabled={cartBusy} onClick={async () => {
              if (await addQuizSet(top.map((r) => r.p.id))) track("quiz", "Added the suggested set to basket", { slugs: top.map((r) => r.p.slug) });
            }}>Add the set to basket</button>
            <button className="btn ghost" onClick={reset}>Start again</button>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-3)" }}>These suggestions are general information, not medical advice. Your answers are saved on this device so you can come back to them.</p>
      </div></main>
    );
  }

  const q = steps[i];
  const cur = a[q.id] ?? [];
  const choose = (oid: string) => {
    const next = q.multi ? (cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid]) : [oid];
    setQuiz({ ...quiz, answers: { ...a, [q.id]: next }, step: i });
    if (i === 0 && !Object.keys(a).length) track("quiz", "Started the quiz");
  };
  const next = () => {
    const step = i + 1;
    const nextAnswers = a;
    const remaining = store.quiz.filter((x) => x.on && x.opts.length && shown(x, nextAnswers));
    if (step >= remaining.length) {
      // Finished: remember the result so the homepage can offer it back.
      const slugs: string[] = [];
      for (const s of remaining) for (const o of s.opts) if (has(nextAnswers, s.id, o.id) && o.productSlug && !slugs.includes(o.productSlug)) slugs.push(o.productSlug);
      setQuiz({ answers: nextAnswers, step, productSlugs: slugs.slice(0, f.quiz.max), gp: remaining.some((s) => s.opts.some((o) => o.gp && has(nextAnswers, s.id, o.id))), at: new Date().toISOString() });
      track("quiz", "Finished the quiz", { slugs });
    } else setQuiz({ ...quiz, step });
  };

  return (
    <main className="wrap"><div className="quiz">
      <div className="qbar" aria-label={`Question ${i + 1} of ${steps.length}`}><span style={{ width: `${(i / steps.length) * 100}%` }} /></div>
      <p style={{ color: "var(--ink-2)", fontWeight: 600 }}>Question {i + 1} of {steps.length}</p>
      <h1>{q.q}</h1>
      {q.multi && <p style={{ color: "var(--ink-2)" }}>Choose as many as you like.</p>}
      <div className="qopts">{q.opts.map((o) => (
        <button key={o.id} className="qopt" aria-pressed={cur.includes(o.id)} onClick={() => choose(o.id)}>{o.label}{cur.includes(o.id) && <span>✓</span>}</button>
      ))}</div>
      <div className="qnav">
        <button className="btn ghost" disabled={i === 0} onClick={() => setQuiz({ ...quiz, step: i - 1 })}>Back</button>
        <button className="btn" disabled={!cur.length} onClick={next}>{i === steps.length - 1 ? "See my set" : "Next"}</button>
      </div>
    </div></main>
  );
}
