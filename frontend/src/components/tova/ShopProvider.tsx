"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, authApi, cartApi, sendTrack, ApiError } from "../../lib/tova/api";
import { memory, type QuizMemory } from "../../lib/tova/memory";
import type { Cart, Product, Storefront, User } from "../../lib/tova/types";

interface ShopState {
  products: Product[];
  store: Storefront | null;
  bySlug: Map<string, Product>;
  byId: Map<string, Product>;
  live: Product[];

  cart: Cart | null;
  cartBusy: boolean;
  addItem: (p: Product, qty?: number, subscriptionMonths?: number | null) => Promise<boolean>;
  addBundle: (bundleId: string, name: string) => Promise<boolean>;
  addQuizSet: (productIds: string[]) => Promise<boolean>;
  setQty: (itemId: string, qty: number) => Promise<void>;
  setSub: (itemId: string, months: number | null) => Promise<void>;
  removeLine: (itemId: string) => Promise<void>;
  applyCode: (code: string | null) => Promise<string | null>;
  setRedeem: (redeem: boolean) => Promise<void>;
  rememberPostcode: (postcode: string) => Promise<string | null>;
  refreshCart: () => Promise<void>;

  user: User | null;
  userReady: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (d: { email: string; password: string; firstName: string; lastName: string; marketingEmail: boolean; birthdayDay?: number | null; birthdayMonth?: number | null }) => Promise<void>;
  saveBirthday: (day: number | null, month: number | null) => Promise<void>;
  signOut: () => Promise<void>;

  recent: string[];
  viewed: (slug: string) => void;
  quiz: QuizMemory;
  setQuiz: (q: QuizMemory) => void;

  drawer: boolean; setDrawer: (o: boolean) => void;
  menu: boolean; setMenu: (o: boolean) => void;
  toast: { msg: string; basket?: boolean } | null;
  say: (msg: string, basket?: boolean) => void;

  consent: "all" | "essential" | null;
  setConsent: (c: "all" | "essential") => void;
  track: (type: string, message: string, meta?: Record<string, unknown>) => void;
}

const Ctx = createContext<ShopState | null>(null);
export const useShop = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShop must be used inside ShopProvider");
  return c;
};

const EMPTY_QUIZ: QuizMemory = { answers: {}, step: 0 };
const BROWSER_EVENTS = new Set(["visit", "view", "search", "quiz", "checkout"]);

/** One "visit" per browser visit (tab session): landing page, campaign, referring site, device, and whether they're new. */
function sendVisit() {
  try { if (sessionStorage.getItem("tova:visited")) return; sessionStorage.setItem("tova:visited", "1"); } catch { /* still send once */ }
  const first = !memory.source();
  const src = memory.keepSource();
  const here = memory.landing();
  const from = here?.utm_source ?? here?.referrer;
  sendTrack("visit", `${first ? "First visit" : "Returning visit"}${from ? ` from ${from}` : ""} on a ${here?.device ?? "device"}`, memory.sessionId(), {
    path: location.pathname, device: here?.device, referrer: here?.referrer, utm_source: here?.utm_source, utm_medium: here?.utm_medium, utm_campaign: here?.utm_campaign,
    returning: !first, firstSource: src?.utm_source ?? src?.referrer ?? "direct",
  });
}

export function ShopProvider({ initialProducts, initialStore, children }: { initialProducts: Product[] | null; initialStore: Storefront | null; children: ReactNode }) {
  // Server data first (fresh, and what search engines see); the browser cache
  // fills in when the server render couldn't reach the backend.
  const [products, setProducts] = useState<Product[]>(initialProducts ?? []);
  const [store, setStore] = useState<Storefront | null>(initialStore);
  const [cart, setCart] = useState<Cart | null>(null);
  const [cartBusy, setCartBusy] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [userReady, setUserReady] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [quiz, setQuizState] = useState<QuizMemory>(EMPTY_QUIZ);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<{ msg: string; basket?: boolean } | null>(null);
  const [consent, setConsentState] = useState<"all" | "essential" | null>("essential"); // hide the bar until we've read storage
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const say = useCallback((msg: string, basket = false) => {
    setToast({ msg, basket });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Only browser-side moments are sent; baskets, orders and payments are logged by the server itself.
  const track = useCallback((type: string, message: string, meta?: Record<string, unknown>) => {
    if (memory.consent() === "all" && BROWSER_EVENTS.has(type)) sendTrack(type, message, memory.sessionId(), meta);
  }, []);

  // ── First load: cache, then refresh in the background ──
  useEffect(() => {
    if (initialProducts) memory.set("catalogue", initialProducts);
    else { const c = memory.get<Product[]>("catalogue"); if (c) setProducts(c); }
    if (initialStore) memory.set("storefront", initialStore);
    else { const c = memory.get<Storefront>("storefront"); if (c) setStore(c); }

    setRecent(memory.recentlyViewed());
    setQuizState(memory.get<QuizMemory>("quiz") ?? EMPTY_QUIZ);
    setConsentState(memory.consent());

    if (!initialProducts) api<{ products: Product[] }>("/catalogue").then((r) => { setProducts(r.products); memory.set("catalogue", r.products); }).catch(() => {});
    if (!initialStore) api<Storefront>("/storefront").then((s) => { setStore(s); memory.set("storefront", s); }).catch(() => {});

    cartApi.get().then((r) => setCart(r.cart)).catch(() => {});
    authApi.me().then((u) => { setUser(u); setUserReady(true); if (u) void syncSaved(); });
    if (memory.consent() === "all") sendVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Account memory: merge this browser's recently viewed + quiz with the account's ──
  const syncSaved = useCallback(async () => {
    try {
      const { state } = await authApi.savedState();
      const serverRecent = Array.isArray(state.recentlyViewed) ? (state.recentlyViewed as string[]) : [];
      const merged = [...new Set([...memory.recentlyViewed(), ...serverRecent])].slice(0, 12);
      memory.setRecentlyViewed(merged);
      setRecent(merged);
      const localQuiz = memory.get<QuizMemory>("quiz");
      const serverQuiz = state.quiz as QuizMemory | undefined;
      const newest = [localQuiz, serverQuiz].filter((q): q is QuizMemory => !!q?.at).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))[0];
      if (newest) { memory.set("quiz", newest); setQuizState(newest); }
      await authApi.saveState({ recentlyViewed: merged, ...(newest ? { quiz: newest } : {}) });
    } catch { /* memory is a nicety, never a blocker */ }
  }, []);

  const pushSaved = useRef<ReturnType<typeof setTimeout>>();
  const saveToAccount = useCallback((patch: Record<string, unknown>) => {
    if (!user) return;
    clearTimeout(pushSaved.current);
    pushSaved.current = setTimeout(() => { authApi.saveState(patch).catch(() => {}); }, 800);
  }, [user]);

  const viewed = useCallback((slug: string) => {
    const list = memory.addRecentlyViewed(slug);
    setRecent(list);
    saveToAccount({ recentlyViewed: list });
  }, [saveToAccount]);

  const setQuiz = useCallback((q: QuizMemory) => {
    setQuizState(q);
    memory.set("quiz", q);
    if (q.productSlugs) saveToAccount({ quiz: q });
  }, [saveToAccount]);

  // ── Basket ──
  const run = useCallback(async (fn: () => Promise<{ cart: Cart }>, okMsg?: string, open = false): Promise<boolean> => {
    setCartBusy(true);
    try {
      const r = await fn();
      setCart(r.cart);
      if (okMsg) say(okMsg, true);
      if (open) setDrawer(true);
      return true;
    } catch (e) {
      say(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      return false;
    } finally { setCartBusy(false); }
  }, [say]);

  const addItem = useCallback(async (p: Product, qty = 1, months: number | null = null) => {
    const ok = await run(() => cartApi.add(p.id, qty, months), `${p.name} added to your basket`);
    if (ok) track("basket", `Added ${p.name} to basket${months ? " (Subscribe & Save)" : ""}`, { slug: p.slug });
    return ok;
  }, [run, track]);
  const addBundle = useCallback((id: string, name: string) => run(() => cartApi.addBundle(id), `${name} added to your basket`), [run]);
  const addQuizSet = useCallback((ids: string[]) => run(() => cartApi.addQuizSet(ids), "Your set is in your basket", true), [run]);
  const setQty = useCallback(async (id: string, q: number) => { await run(() => cartApi.setQty(id, q)); }, [run]);
  const setSub = useCallback(async (id: string, m: number | null) => { await run(() => cartApi.setSub(id, m)); }, [run]);
  const removeLine = useCallback(async (id: string) => { await run(() => cartApi.remove(id)); }, [run]);
  const setRedeem = useCallback(async (r: boolean) => { await run(() => cartApi.points(r)); }, [run]);
  const refreshCart = useCallback(async () => { try { setCart((await cartApi.get()).cart); } catch { /* keep what we have */ } }, []);

  const applyCode = useCallback(async (code: string | null): Promise<string | null> => {
    try { setCart((await cartApi.code(code)).cart); return null; }
    catch (e) { return e instanceof ApiError ? e.message : "That code couldn't be checked. Please try again."; }
  }, []);
  const rememberPostcode = useCallback(async (postcode: string): Promise<string | null> => {
    try { setCart((await cartApi.remember({ postcode })).cart); return null; }
    catch (e) { return e instanceof ApiError ? e.message : null; }
  }, []);

  // ── Account ──
  const afterAuth = useCallback(async (u: User) => {
    setUser(u);
    await refreshCart(); // the guest basket is now the account's (merged server-side)
    await syncSaved();
  }, [refreshCart, syncSaved]);
  const signIn = useCallback(async (email: string, password: string) => { const r = await authApi.login(email, password); await afterAuth(r.user); }, [afterAuth]);
  const signUp = useCallback(async (d: Parameters<ShopState["signUp"]>[0]) => { const r = await authApi.register(d); await afterAuth(r.user); }, [afterAuth]);
  const saveBirthday = useCallback(async (day: number | null, month: number | null) => {
    const r = await authApi.updateProfile({ birthdayDay: day, birthdayMonth: month });
    setUser((u) => (u ? { ...u, birthdayDay: r.user.birthdayDay ?? null, birthdayMonth: r.user.birthdayMonth ?? null } : u));
  }, []);
  const signOut = useCallback(async () => { await authApi.logout().catch(() => {}); setUser(null); await refreshCart(); }, [refreshCart]);

  const setConsent = useCallback((c: "all" | "essential") => {
    memory.setConsent(c); setConsentState(c);
    if (c === "all") sendVisit();
  }, []);

  const value = useMemo<ShopState>(() => {
    const bySlug = new Map(products.map((p) => [p.slug, p]));
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      products, store, bySlug, byId, live: products.filter((p) => p.status === "active" || p.status === "out_of_stock"),
      cart, cartBusy, addItem, addBundle, addQuizSet, setQty, setSub, removeLine, applyCode, setRedeem, rememberPostcode, refreshCart,
      user, userReady, signIn, signUp, signOut, saveBirthday,
      recent, viewed, quiz, setQuiz,
      drawer, setDrawer, menu, setMenu, toast, say,
      consent, setConsent, track,
    };
  }, [products, store, cart, cartBusy, addItem, addBundle, addQuizSet, setQty, setSub, removeLine, applyCode, setRedeem, rememberPostcode, refreshCart,
    user, userReady, signIn, signUp, signOut, saveBirthday, recent, viewed, quiz, setQuiz, drawer, menu, toast, say, consent, setConsent, track]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
