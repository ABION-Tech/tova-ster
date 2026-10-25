import type { Cart, IgFeed, Product, Receipt, Storefront, User } from "./types";

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Browser calls: cookies included (session + guest basket). Errors carry the shopper-facing message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  } catch {
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Server faults never show raw text to shoppers; 4xx messages are written for them.
    const msg = res.status >= 500 ? "We couldn't reach the shop just now. Please try again in a moment." : (body as { error?: string }).error ?? "Something went wrong. Please try again.";
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

// ── Server-side reads (pages are rendered with real data for search engines) ──

async function serverGet<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // backend unreachable: the browser falls back to its cached copy
  }
}

export const serverGetPublic = <T,>(path: string) => serverGet<T>(path, 300);
export const getCatalogueServer = async () => (await serverGet<{ products: Product[] }>("/catalogue"))?.products ?? null;
export const getStorefrontServer = () => serverGet<Storefront>("/storefront");

// ── Basket ──
type CartRes = { cart: Cart };
export const cartApi = {
  get: () => api<CartRes>("/cart"),
  add: (productId: string, quantity: number, subscriptionMonths: number | null) =>
    api<CartRes>("/cart/items", { method: "POST", json: { productId, quantity, subscriptionMonths } }),
  addBundle: (bundleId: string) => api<CartRes>("/cart/bundles", { method: "POST", json: { bundleId } }),
  addQuizSet: (productIds: string[]) => api<CartRes>("/cart/quiz-set", { method: "POST", json: { productIds } }),
  setQty: (itemId: string, quantity: number) => api<CartRes>(`/cart/items/${itemId}`, { method: "PATCH", json: { quantity } }),
  setSub: (itemId: string, subscriptionMonths: number | null) => api<CartRes>(`/cart/items/${itemId}`, { method: "PATCH", json: { subscriptionMonths } }),
  remove: (itemId: string) => api<CartRes>(`/cart/items/${itemId}`, { method: "DELETE" }),
  code: (code: string | null) => api<CartRes>("/cart/code", { method: "PUT", json: { code } }),
  points: (redeem: boolean) => api<CartRes>("/cart/points", { method: "PUT", json: { redeem } }),
  remember: (data: { postcode?: string | null; email?: string | null }) => api<CartRes>("/cart/remember", { method: "PUT", json: data }),
};

// ── Account ──
export const authApi = {
  me: async (): Promise<User | null> => { try { return (await api<{ user: User | null }>("/auth/session")).user; } catch { return null; } },
  login: (email: string, password: string) => api<{ user: User }>("/auth/login", { method: "POST", json: { email, password } }),
  updateProfile: (d: { birthdayDay?: number | null; birthdayMonth?: number | null }) => api<{ user: User }>("/profile", { method: "PATCH", json: d }),
  register: (d: { email: string; password: string; firstName: string; lastName: string; marketingEmail: boolean; birthdayDay?: number | null; birthdayMonth?: number | null }) =>
    api<{ user: User }>("/auth/register", { method: "POST", json: d }),
  logout: () => api<void>("/auth/logout", { method: "POST", json: {} }),
  savedState: () => api<{ state: Record<string, unknown> }>("/me/saved-state"),
  saveState: (state: Record<string, unknown>) => api<void>("/me/saved-state", { method: "PUT", json: { state } }),
};

// ── Orders & receipts ──
export interface PlaceOrder {
  customer: { name: string; email: string; phone: string };
  delivery: { recipientName: string; phone: string; line1: string; line2?: string; city: string; postalCode: string; instructions?: string };
  source?: Record<string, string>;
}
export const orderApi = {
  place: (d: PlaceOrder) => api<{ order: { id: string; orderNumber: string; total: number } }>("/orders", { method: "POST", json: d }),
  pay: (orderId: string) => api<{ checkoutUrl: string; reference: string }>(`/orders/${orderId}/pay`, { method: "POST", json: {} }),
  receiptByReference: (reference: string) => api<{ receipt?: Receipt; pending?: boolean; orderNumber?: string }>(`/receipts/by-reference?reference=${encodeURIComponent(reference)}`),
  receipt: (orderNumber: string) => api<{ receipt: Receipt }>(`/orders/${encodeURIComponent(orderNumber)}/receipt`),
  mine: () => api<{ orders: { orderNumber: string; status: string; total: string | number; placedAt: string; itemCount?: number }[] }>("/orders"),
  testPay: (reference: string) => api<{ received: boolean }>("/webhooks/test", { method: "POST", json: { reference } }),
};

/** Analytics beacon: only ever called after the shopper accepts analytics cookies. */
export function sendTrack(type: string, message: string, sessionId: string, meta?: Record<string, unknown>) {
  fetch(`${BACKEND_URL}/track`, {
    method: "POST", credentials: "include", keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, message, sessionId, meta }),
  }).catch(() => {});
}

export const newsletterApi = {
  signup: (email: string) => api<void>("/newsletter", { method: "POST", json: { email, consent: true, source: "homepage" } }),
};

export const freebieApi = {
  claim: (email: string, where: string) => api<{ downloadUrl: string; code: string | null; pct: number | null }>("/freebie", { method: "POST", json: { email, consent: true, where } }),
};

export const igApi = {
  feed: (limit = 60) => api<IgFeed>(`/instagram/feed?limit=${limit}`),
};
export const getIgFeedServer = (limit = 300) => serverGetPublic<IgFeed>(`/instagram/feed?limit=${limit}`);
