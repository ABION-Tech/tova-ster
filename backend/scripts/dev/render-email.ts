// Writes an email template to HTML so it can be looked at: tsx scripts/dev/render-email.ts <template> '<json data>' > out.html
import { ResendAdapter } from "../../src/services/email/ResendAdapter.js";
const [template, json] = process.argv.slice(2);
const a = new ResendAdapter() as unknown as { send: (p: unknown) => Promise<unknown> };
// Capture the HTML the adapter would send, without calling Resend.
process.env.RESEND_API_KEY = "re_dummy"; process.env.EMAIL_FROM = "Tova-Ster <x@y.z>";
globalThis.fetch = (async (_u: string, init: { body: string }) => { process.stdout.write(JSON.parse(init.body).html); return new Response(JSON.stringify({ id: "x" })); }) as unknown as typeof fetch;
a.send({ to: "a@b.c", subject: "s", template, data: JSON.parse(json ?? "{}") });
