// Cookies must be Secure + SameSite=None whenever the shop and the server are
// served over HTTPS on different hosts (production, and the pre-launch preview
// on Railway, which runs with NODE_ENV=staging so test payments stay possible).
// Locally (plain http://localhost) they fall back to Lax without Secure.
export const secureCookies = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
