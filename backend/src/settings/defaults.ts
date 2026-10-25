// Defaults for every admin-controlled setting. Stored rows in site_settings
// are deep-merged over these, so a new field added here appears for existing
// shops without a migration.

export interface Media { src: string; kind: "image" | "video" }
const img = (src: string): Media => ({ src, kind: "image" });

export const DEFAULT_FEATURES = {
  announcement: { on: true, messages: ["Free UK delivery on orders over £40", "Subscribe & save 15% on every order", "3 for 2 across the whole range"] },
  freeDelivery: { on: true, threshold: 40 },
  subscribe: { on: true, discount: 15, freqs: [1, 2, 3] },
  multibuy: { on: true, mode: "3for2" as "3for2" | "2save10" | "3save20" },
  bundles: { on: true },
  rewards: { on: true, earn: 5, pointValue: 1, signup: 100, minRedeem: 500 },
  quiz: { on: true, discount: 10, max: 3 },
  codes: { on: true },
  welcome: { on: true, pct: 10, code: "WELCOME10" },
  crossSell: { on: true },
  reviews: { on: true },
  stockUrgency: { on: true, under: 10 },
  payments: { applePay: true, googlePay: true, card: true, paypal: true, klarna: false },
  // Birthday treat: once a year on the customer's birthday (day and month only, no year stored).
  birthday: { on: true, points: 200 },
  // Growth tool: a free download in exchange for an email (with consent).
  freebie: {
    on: true,
    title: "Free guide: your UK winter vitamin plan",
    text: "Two pages, no jargon: how much vitamin D the NHS suggests, who needs it most, and how to build a simple daily routine.",
    button: "Email me the free guide",
    fileUrl: "/downloads/tova-ster-winter-vitamin-guide.pdf",
    cover: null as Media | null,
    popup: true,          // also offer it in a pop-up (not on checkout or account pages)
    delaySec: 25,         // pop-up appears after this many seconds…
    exitIntent: true,     // …or when a desktop visitor moves to leave
    remindDays: 14,       // after "No thanks", wait this long before asking again
    giveCode: true,       // show the welcome code after sign-up
  },
};

export const DEFAULT_DELIVERY = { mainland: 3.99, highlands: 7.99, ni: 5.99, cutoffHour: 14, vat: 20 };

export const DEFAULT_BUSINESS = {
  name: "Tova-Ster Ltd",
  address: "Registered address to confirm, United Kingdom",
  company: "Company no. to confirm",
  vatNo: "GB VAT no. to confirm",
  vatRegistered: true,
  email: "info@tova-ster.com",
  web: "tova-ster.com",
  footer: "Thank you for shopping with Tova-Ster. Questions about your order? Email info@tova-ster.com.",
  instagram: "tovaster1",
  retentionMonths: 26,
  alertEmail: "info@tova-ster.com",  // where team alerts (new orders, low stock) are sent   // browsing records (visits, views, searches, quiz steps) older than this are deleted; orders are kept
};

export const DEFAULT_EMAILS = {
  welcome: true, dispatched: true, delivered: true, basket: true, basketSteps: [1, 3, 7], basketCodeOn: true, basketCode: 10,
  subReminder: true, points: true, review: true, backInStock: true, winback: true, winbackDays: 60,
  basketAfterHours: 24,   // a basket untouched this long (with items, not checked out) counts as abandoned
  adminNewOrder: true,    // email the team when an order is paid
  adminLowStock: true,    // email the team when a sale takes stock down to its low-stock level
};

export const DEFAULT_DISPATCH = {
  autoLabel: true, batchOn: true, batchTime: 13, scanDispatch: true, trackingEmail: true, deliveredEmail: true, reviewEmail: true,
  holdOn: true, holdOver: 120, autoHideOOS: true, subsAuto: true, subsDays: 3, partner: false,
  carriers: { mainland: "Royal Mail Tracked 48", highlands: "Royal Mail Tracked 48", ni: "DPD Next Day" },
};


export interface HeroSlide {
  id: string;
  on: boolean;
  productSlug: string;      // product this slide sells (price shown from the live catalogue)
  kicker: string;
  title: string;
  text: string;
  ctaLabel: string;
  ctaHref: string;
  media: Media | null;      // full-width banner (image or video); product on the right, space for words on the left
  tone: "light" | "dark";   // light picture = dark words, dark picture = light words
  bg: string;               // colour behind the words on phones (matches the picture)
}

export const DEFAULT_HERO_SLIDES: HeroSlide[] = [
  { id: "iron", on: true, productSlug: "iron-vitamin-c", kicker: "Iron & Vitamin C gummies",
    title: "Wellness for your whole self",
    text: "Iron and vitamin C in a berry gummy. Iron contributes to the reduction of tiredness and fatigue, and vitamin C increases iron absorption.",
    ctaLabel: "Shop Iron & Vitamin C", ctaHref: "/products/iron-vitamin-c", media: img("/brand/hero-iron-vitamin-c.jpg"), tone: "light", bg: "#F2EEEA" },
  { id: "collagen", on: true, productSlug: "collagen-complex", kicker: "Skin, hair & nails",
    title: "Your daily beauty gummy",
    text: "Collagen Complex: orange-flavour gummies with biotin and selenium, which contribute to the maintenance of normal hair.",
    ctaLabel: "Shop Collagen Complex", ctaHref: "/products/collagen-complex", media: img("/brand/hero-collagen.jpg"), tone: "light", bg: "#F8E4DF" },
  { id: "creatine", on: true, productSlug: "creatine-monohydrate", kicker: "For training",
    title: "Built for your hardest sessions",
    text: "Creatine increases physical performance in successive bursts of short-term, high-intensity exercise. The beneficial effect is obtained with a daily intake of 3 g of creatine.",
    ctaLabel: "Shop creatine", ctaHref: "/products/creatine-monohydrate", media: img("/brand/hero-creatine.jpg"), tone: "dark", bg: "#0E0E0E" },
  { id: "kids", on: true, productSlug: "kids-multivitamin-mineral", kicker: "For children",
    title: "Little ones, big days",
    text: "Multivitamin and Mineral for Children: nine nutrients in a berry gummy. Vitamin D is needed for normal growth and development of bone in children.",
    ctaLabel: "Shop kids' gummies", ctaHref: "/products/kids-multivitamin-mineral", media: img("/brand/hero-kids-multivitamin.jpg"), tone: "light", bg: "#F8E6EA" },
];

export const DEFAULT_SITE = {
  hero: {
    slides: DEFAULT_HERO_SLIDES,
    autoplay: true,
    intervalSec: 3.9,
  },
  needs: {} as Record<string, Media>,
  needsAutoplay: true,
  banner: { on: true, title: "Made for your whole self", text: "From the morning vitamin D to your daily gummies, every Tova-Ster formula is made to fit an ordinary day.", media: img("/brand/creatine.jpg") as Media | null },
  insta: {
    on: true, handle: "tovaster1", url: "https://www.instagram.com/tovaster1",
    // "instagram": live feed from the connected account; "manual": the posts chosen below.
    source: "instagram" as "instagram" | "manual",
    homeCount: 6,
    // Shown only until the live Instagram feed is connected.
    posts: [img("/brand/iron-vitamin-c.jpg"), img("/brand/kids-multivitamin.jpg"), img("/brand/collagen.jpg"), img("/brand/creatine.jpg"), img("/brand/hero-collagen.jpg"), img("/brand/hero-iron-vitamin-c.jpg")] as (Media | null)[],
  },
};

export interface QuizOption { id: string; label: string; productSlug: string; why: string; gp: boolean }
export interface QuizQuestion { id: string; q: string; multi: boolean; on: boolean; showIf: { q: string; op: "is" | "not"; o: string } | null; opts: QuizOption[] }

const notChild = { q: "who", op: "not" as const, o: "child" };
export const DEFAULT_QUIZ: QuizQuestion[] = [
  { id: "who", q: "Who are you shopping for?", multi: false, on: true, showIf: null, opts: [
    { id: "me", label: "Me", productSlug: "", why: "", gp: false },
    { id: "child", label: "My child", productSlug: "kids-multivitamin-mineral", why: "Nine nutrients in a chewable berry gummy. Vitamin D is needed for normal growth and development of bone in children.", gp: false },
    { id: "both", label: "Me and my child", productSlug: "kids-multivitamin-mineral", why: "Nine nutrients in a chewable berry gummy for your child. Vitamin D is needed for normal growth and development of bone in children.", gp: false },
  ] },
  { id: "focus", q: "What would you like to focus on?", multi: true, on: true, showIf: notChild, opts: [
    { id: "energy", label: "Energy & tiredness", productSlug: "iron-vitamin-c", why: "Iron contributes to the reduction of tiredness and fatigue, and vitamin C increases iron absorption.", gp: false },
    { id: "immunity", label: "Immunity", productSlug: "vitamin-d3-4000iu", why: "Vitamin D contributes to the normal function of the immune system.", gp: false },
    { id: "bones", label: "Bones & muscles", productSlug: "vitamin-d3-4000iu", why: "Vitamin D contributes to the maintenance of normal bones and normal muscle function.", gp: false },
    { id: "beauty", label: "Skin, hair & nails", productSlug: "collagen-complex", why: "Vitamin C contributes to normal collagen formation for the normal function of skin.", gp: false },
    { id: "training", label: "Training", productSlug: "creatine-monohydrate", why: "Creatine increases physical performance in successive bursts of short-term, high-intensity exercise.", gp: false },
  ] },
  { id: "sun", q: "Between October and March, how often are you outside in daylight?", multi: false, on: true, showIf: notChild, opts: [
    { id: "most", label: "Most days", productSlug: "", why: "", gp: false },
    { id: "some", label: "A few times a week", productSlug: "vitamin-d3-4000iu", why: "From October to March the UK sun is too low for your skin to make enough vitamin D.", gp: false },
    { id: "rare", label: "Rarely", productSlug: "vitamin-d3-4000iu", why: "From October to March the UK sun is too low for your skin to make enough vitamin D.", gp: false },
  ] },
  { id: "train", q: "Do you train hard three or more times a week?", multi: false, on: true, showIf: notChild, opts: [
    { id: "yes", label: "Yes", productSlug: "creatine-monohydrate", why: "Creatine increases physical performance in successive bursts of short-term, high-intensity exercise.", gp: false },
    { id: "no", label: "No", productSlug: "", why: "", gp: false },
  ] },
  { id: "med", q: "Are you pregnant, breastfeeding or taking any medication?", multi: false, on: true, showIf: null, opts: [
    { id: "yes", label: "Yes", productSlug: "", why: "", gp: true },
    { id: "no", label: "No", productSlug: "", why: "", gp: false },
  ] },
];

export const SETTINGS_DEFAULTS = {
  features: DEFAULT_FEATURES,
  delivery: DEFAULT_DELIVERY,
  business: DEFAULT_BUSINESS,
  emails: DEFAULT_EMAILS,
  dispatch: DEFAULT_DISPATCH,
  site: DEFAULT_SITE,
  quiz: DEFAULT_QUIZ,
};

export type SettingsKey = keyof typeof SETTINGS_DEFAULTS;
export const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as SettingsKey[];
