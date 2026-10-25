// Shapes returned by the backend. Kept in one file so a backend change shows up here once.

export interface Media { src: string; kind: "image" | "video" }

export interface Product {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  pack_size: string | null;
  format: string;
  servings: number;
  needs: string[];
  audiences: string[];
  badge: string | null;
  benefits: string[];
  how_to_take: string | null;
  ingredients: string | null;
  facts: [string, string][];
  warnings: string | null;
  video_url: string | null;
  sort_order: number;
  price: number;
  wasPrice: number | null;
  status: string;
  created_at: string;
  category: string | null;
  images: { url: string; alt: string | null }[];
  rating: number | null;
  review_count: number;
  inStock: boolean;
  onlyLeft: number | null;
}

export interface Features {
  announcement: { on: boolean; messages: string[] };
  freeDelivery: { on: boolean; threshold: number };
  subscribe: { on: boolean; discount: number; freqs: number[] };
  multibuy: { on: boolean; mode: "3for2" | "2save10" | "3save20" };
  bundles: { on: boolean };
  rewards: { on: boolean; earn: number; pointValue: number; signup: number; minRedeem: number };
  quiz: { on: boolean; discount: number; max: number };
  codes: { on: boolean };
  welcome: { on: boolean; pct: number; code: string };
  crossSell: { on: boolean };
  reviews: { on: boolean };
  stockUrgency: { on: boolean; under: number };
  payments: { applePay: boolean; googlePay: boolean; card: boolean; paypal: boolean; klarna: boolean };
  birthday: { on: boolean; points: number };
  freebie: { on: boolean; title: string; text: string; button: string; fileUrl: string; cover: Media | null; popup: boolean; delaySec: number; exitIntent: boolean; remindDays: number; giveCode: boolean };
}

export interface HeroSlide { id: string; on: boolean; productSlug: string; kicker: string; title: string; text: string; ctaLabel: string; ctaHref: string; media: Media | null; tone?: "light" | "dark"; bg?: string }

export interface IgPost {
  id: string;
  type: "image" | "video" | "album";
  src: string | null;
  thumb: string | null;
  permalink: string;
  caption: string | null;
  postedAt: string | null;
  children: { type: string; src: string | null; thumb: string | null }[];
}
export interface IgFeed { on: boolean; handle: string; url: string; live: boolean; posts: IgPost[] }

export interface QuizOption { id: string; label: string; productSlug: string; why: string; gp: boolean }
export interface QuizQuestion { id: string; q: string; multi: boolean; on: boolean; showIf: { q: string; op: "is" | "not"; o: string } | null; opts: QuizOption[] }

export interface StoreBundle {
  id: string; name: string; blurb: string | null; pct: number;
  products: { id: string; slug: string; name: string; price: number; image: string | null }[];
}

export interface Storefront {
  features: Features;
  delivery: { mainland: number; highlands: number; ni: number; cutoffHour: number; vat: number };
  business: { name: string; email: string; web: string; instagram: string; address: string; company: string; vatNo: string; vatRegistered: boolean };
  site: {
    hero: { slides: HeroSlide[]; autoplay: boolean; intervalSec: number };
    needs: Record<string, Media>;
    needsAutoplay: boolean;
    banner: { on: boolean; title: string; text: string; media: Media | null };
    insta: { on: boolean; handle: string; url: string; source: "instagram" | "manual"; homeCount: number; posts: (Media | null)[] };
  };
  quiz: QuizQuestion[];
  bundles: StoreBundle[];
}

export interface CartLine {
  id: string;
  productId: string;
  slug: string;
  quantity: number;
  productName: string;
  packSize: string | null;
  imageUrl: string | null;
  currentPrice: number;
  chargedUnit: number;
  lineTotal: number;
  currentStock: number | null;
  isPurchasable: boolean;
  priceChanged: boolean;
  quantityExceedsStock: boolean;
  subscriptionMonths: number | null;
  isSubscription: boolean;
  bundleId: string | null;
  bundleName: string | null;
}

export interface CartPricing {
  full: number;
  subscribeSaving: number;
  bundleSaving: number;
  multibuySaving: number;
  multibuyLabel: string | null;
  codeSaving: number;
  code: string | null;
  pointsUsed: number;
  pointsSaving: number;
  merchandise: number;
  delivery: number;
  deliveryZone: "mainland" | "highlands" | "ni";
  deliveryIsEstimate: boolean;
  freeDeliveryThreshold: number | null;
  amountToFreeDelivery: number;
  total: number;
  vat: number;
  pointsEarned: number;
  saved: number;
  itemCount: number;
  hasSubscription: boolean;
  discounts: { type: string; label: string; amount: number }[];
}

export interface Cart {
  id: string;
  items: CartLine[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  hasBlockingIssues: boolean;
  pricing: CartPricing;
  code: string | null;
  codeError: string | null;
  redeemPoints: boolean;
  pointsBalance: number;
  signedIn: boolean;
  postcode: string | null;
  email: string | null;
}

export interface User { id: string; email: string; firstName: string; lastName: string; emailVerified: boolean; phone?: string; birthdayDay?: number | null; birthdayMonth?: number | null }

export interface Receipt {
  receiptNumber: string;
  orderNumber: string;
  placedAt: string;
  paidAt: string | null;
  status: string;
  stage: string;
  carrier: string | null;
  trackingNumber: string | null;
  customer: { name: string; email: string };
  address: { name: string; line1: string; line2: string | null; city: string; postcode: string } | null;
  items: { name: string; quantity: number; fullUnitPrice: number; unitPrice: number; lineTotal: number; subscriptionMonths: number | null; bundleName: string | null }[];
  discounts: { type: string; label: string; amount: number }[];
  subtotal: number;
  discountTotal: number;
  delivery: number;
  total: number;
  vat: number;
  pointsEarned: number;
  pointsUsed: number;
  paymentMethod: string | null;
  business: { name: string; address: string; company: string; vatNo: string; vatRegistered: boolean; email: string; web: string; footer: string };
}
