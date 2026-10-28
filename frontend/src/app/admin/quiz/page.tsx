"use client";

import { useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";

interface Opt { id: string; label: string; productSlug: string; why: string; gp: boolean }
interface Q { id: string; q: string; multi: boolean; on: boolean; showIf: { q: string; op: "is" | "not"; o: string } | null; opts: Opt[] }
interface Product { slug: string; name: string; status: string }

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export default function QuizAdmin() {
  const [quiz, setQuiz] = useState<Q[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    adminJson<{ settings: { quiz: Q[] } }>("/admin/settings").then((d) => setQuiz(d.settings.quiz)).catch((e: Error) => setMsg(e.message));
    adminJson<{ products: Product[] }>("/admin/products").then((d) => setProducts(d.products.filter((p) => p.status !== "archived"))).catch(() => {});
  }, []);

  if (!quiz) return <p className="muted">{msg ?? "Loading…"}</p>;
  const put = (next: Q[]) => { setQuiz(next); setDirty(true); setMsg(null); };
  const editQ = (i: number, patch: Partial<Q>) => put(quiz.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const editO = (i: number, j: number, patch: Partial<Opt>) => editQ(i, { opts: quiz[i].opts.map((o, k) => (k === j ? { ...o, ...patch } : o)) });
  const moveQ = (i: number, d: -1 | 1) => {
    const n = [...quiz]; [n[i], n[i + d]] = [n[i + d], n[i]];
    // A question may only depend on an earlier one: drop conditions that would now point forward.
    put(n.map((q, k) => (q.showIf && !n.slice(0, k).some((p) => p.id === q.showIf!.q) ? { ...q, showIf: null } : q)));
  };
  const removeQ = (i: number) => {
    if (!confirm(`Remove "${quiz[i].q}"?`)) return;
    const gone = quiz[i].id;
    put(quiz.filter((_, k) => k !== i).map((q) => (q.showIf?.q === gone ? { ...q, showIf: null } : q)));
  };
  const addQ = () => {
    const id = newId("q");
    put([...quiz, { id, q: "New question", multi: false, on: false, showIf: null, opts: [
      { id: newId("a"), label: "Yes", productSlug: "", why: "", gp: false }, { id: newId("a"), label: "No", productSlug: "", why: "", gp: false },
    ] }]);
    setOpen(id);
  };

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const d = await adminJson<{ settings: { quiz: Q[] } }>("/admin/settings/quiz", { method: "PUT", body: JSON.stringify({ value: quiz }) });
      setQuiz(d.settings.quiz); setDirty(false); setMsg("Saved. The shop's quiz updates within a minute.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="ahead">
        <div><h1>Quiz</h1><p>The vitamin finder: its questions, the answers, and which product each answer suggests and why.</p></div>
        <button className="btn sm" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      <p className="note">The &ldquo;why&rdquo; shown with a suggestion must be an approved GB health claim, worded in full and naming the nutrient (for example &ldquo;Vitamin D contributes to the normal function of the immune system&rdquo;). Tick &ldquo;GP note&rdquo; for answers where the shopper should check with a doctor or pharmacist first.</p>

      {quiz.map((q, i) => (
        <div key={q.id} className="acard" style={{ opacity: q.on ? 1 : 0.75 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ flex: 1, minWidth: 200 }}>{i + 1}. {q.q}</b>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <span className="switch"><input type="checkbox" checked={q.on} onChange={(e) => editQ(i, { on: e.target.checked })} aria-label={`Show question ${i + 1}`} /><span /></span> Showing
            </label>
            <button className="btn sm ghost" disabled={i === 0} onClick={() => moveQ(i, -1)} aria-label="Move up">↑</button>
            <button className="btn sm ghost" disabled={i === quiz.length - 1} onClick={() => moveQ(i, 1)} aria-label="Move down">↓</button>
            <button className="btn sm ghost" onClick={() => setOpen(open === q.id ? null : q.id)}>{open === q.id ? "Close" : "Edit"}</button>
            <button className="btn sm ghost" disabled={quiz.length <= 1} onClick={() => removeQ(i)}>Remove</button>
          </div>
          {open !== q.id ? (
            <p className="sub">{q.opts.map((o) => o.label).join(" · ")}{q.showIf ? ` — only if "${quiz.find((p) => p.id === q.showIf!.q)?.q}" ${q.showIf.op === "is" ? "is" : "is not"} "${quiz.find((p) => p.id === q.showIf!.q)?.opts.find((o) => o.id === q.showIf!.o)?.label}"` : ""}</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Question
                <input className="ain wide" maxLength={300} value={q.q} onChange={(e) => editQ(i, { q: e.target.value })} /></label>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={q.multi} onChange={(e) => editQ(i, { multi: e.target.checked })} /> Shoppers can pick more than one answer</label>
                {i > 0 && (
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>Ask only if
                    <select className="ain" style={{ width: 220 }} value={q.showIf?.q ?? ""} onChange={(e) => {
                      const dep = quiz.find((p) => p.id === e.target.value);
                      editQ(i, { showIf: dep ? { q: dep.id, op: "is", o: dep.opts[0].id } : null });
                    }}>
                      <option value="">(always ask)</option>
                      {quiz.slice(0, i).map((p) => <option key={p.id} value={p.id}>{p.q}</option>)}
                    </select>
                    {q.showIf && <>
                      <select className="ain" value={q.showIf.op} onChange={(e) => editQ(i, { showIf: { ...q.showIf!, op: e.target.value as "is" | "not" } })}>
                        <option value="is">is</option><option value="not">is not</option>
                      </select>
                      <select className="ain" style={{ width: 160 }} value={q.showIf.o} onChange={(e) => editQ(i, { showIf: { ...q.showIf!, o: e.target.value } })}>
                        {quiz.find((p) => p.id === q.showIf!.q)?.opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </>}
                  </span>
                )}
              </div>
              <div className="tbl-wrap"><table className="t">
                <thead><tr><th>Answer</th><th>Suggests</th><th>Why (approved claim)</th><th>GP note</th><th /></tr></thead>
                <tbody>{q.opts.map((o, j) => (
                  <tr key={o.id}>
                    <td style={{ minWidth: 150 }}><input className="ain wide" maxLength={200} value={o.label} onChange={(e) => editO(i, j, { label: e.target.value })} aria-label="Answer" /></td>
                    <td style={{ minWidth: 180 }}>
                      <select className="ain wide" value={o.productSlug} onChange={(e) => editO(i, j, { productSlug: e.target.value })} aria-label="Suggested product">
                        <option value="">Nothing</option>
                        {products.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                      </select>
                    </td>
                    <td style={{ minWidth: 260 }}><textarea className="ain wide" style={{ height: 60 }} maxLength={500} value={o.why} disabled={!o.productSlug} onChange={(e) => editO(i, j, { why: e.target.value })} aria-label="Why" /></td>
                    <td><input type="checkbox" checked={o.gp} onChange={(e) => editO(i, j, { gp: e.target.checked })} aria-label="Show the GP note" /></td>
                    <td><button className="btn sm ghost" disabled={q.opts.length <= 2} onClick={() => editQ(i, { opts: q.opts.filter((_, k) => k !== j) })}>Remove</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div><button className="btn sm ghost" disabled={q.opts.length >= 10} onClick={() => editQ(i, { opts: [...q.opts, { id: newId("a"), label: "New answer", productSlug: "", why: "", gp: false }] })}>Add an answer</button></div>
            </div>
          )}
        </div>
      ))}
      <div><button className="btn sm" disabled={quiz.length >= 20} onClick={addQ}>Add a question</button> <span className="muted">New questions start hidden until you switch them on.</span></div>
    </>
  );
}
