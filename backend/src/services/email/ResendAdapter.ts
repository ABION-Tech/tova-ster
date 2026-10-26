import type { EmailProviderAdapter, EmailPayload } from "./EmailService.js";

/**
 * Calls the Resend REST API directly — no SDK dependency, same pattern as
 * PaystackAdapter. Only this file may ever call api.resend.com.
 *
 * Required env vars (checked lazily on first send, not at startup — so a
 * missing key fails the specific email call, not the whole server boot):
 *   RESEND_API_KEY   — "re_…" key from the Resend dashboard
 *   EMAIL_FROM       — verified sender, e.g. "Tova-Ster <orders@mail.tova-ster.com>"
 *   EMAIL_REPLY_TO   — optional inbox for replies, e.g. info@tova-ster.com
 */
export class ResendAdapter implements EmailProviderAdapter {
  private get apiKey(): string {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set.");
    return key;
  }

  private get fromAddress(): string {
    const from = process.env.EMAIL_FROM;
    if (!from) throw new Error("EMAIL_FROM is not set.");
    return from;
  }

  async send(payload: EmailPayload): Promise<{ id: string }> {
    const html = renderTemplate(payload.template, payload.data ?? {});

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        // Replies go to a real inbox (EMAIL_REPLY_TO), since mail is sent from a sending-only subdomain.
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
        to: [payload.to],
        subject: payload.subject,
        html,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
    if (!res.ok) {
      throw new Error(`Resend API error ${res.status}: ${body.message ?? body.name ?? "unknown"}`);
    }
    return { id: body.id ?? "unknown" };
  }
}

// ── Template renderer ────────────────────────────────────────────────────────
// All templates use inline styles (email-client compatibility) and the brand
// palette (white bg, gold accent). Keep markup table-free where possible —
// modern email clients handle divs — but avoid anything that Gmail strips.

function renderTemplate(template: string, data: Record<string, unknown>): string {
  switch (template) {
    case "email_verification":
      return verificationEmail(data);
    case "password_reset":
      return passwordResetEmail(data);
    case "order_confirmation":
      return orderConfirmationEmail(data);
    case "order_shipped":
      return orderShippedEmail(data);
    case "order_status_update":
      return orderStatusUpdateEmail(data);
    case "freebie":
      return freebieEmail(data);
    case "birthday":
      return birthdayEmail(data);
    case "admin_new_order":
      return adminNewOrderEmail(data);
    case "admin_low_stock":
      return adminLowStockEmail(data);
    case "admin_invite":
      return adminInviteEmail(data);
    default:
      return genericEmail(data);
  }
}

const BRAND_GOLD = "#B8912B";
const BRAND_DARK = "#241F19";
const BRAND_MUTED = "#756A5C";

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#FAF7F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${BRAND_DARK};">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(60,50,35,0.08);">
    <div style="background:${BRAND_DARK};padding:24px 32px;text-align:center;">
      <span style="color:${BRAND_GOLD};font-size:20px;font-weight:700;letter-spacing:0.04em;">TOVA-STER</span>
    </div>
    <div style="padding:32px;">
      ${body}
    </div>
    <div style="padding:20px 32px;background:#F3EEE3;text-align:center;font-size:12px;color:${BRAND_MUTED};">
      © ${new Date().getFullYear()} Tova-Ster · tova-ster.com · info@tova-ster.com
    </div>
  </div>
</body>
</html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${BRAND_GOLD};color:#2A2110;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;margin:20px 0;">${esc(label)}</a>`;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function str(data: Record<string, unknown>, key: string, fallback = ""): string {
  return String(data[key] ?? fallback);
}

// ── Individual templates ─────────────────────────────────────────────────────

function adminNewOrderEmail(data: Record<string, unknown>): string {
  const items = (data.items as { name: string; qty: number }[] | undefined) ?? [];
  const adminUrl = `${process.env.APP_URL ?? "https://tova-ster.com"}/admin/orders`;
  return shell(
    `New order ${str(data, "orderNumber")}`,
    `<h1 style="font-size:20px;margin:0 0 8px;">New order ${esc(data.orderNumber)}</h1>
     <p style="margin:0 0 12px;"><strong>£${Number(data.total || 0).toFixed(2)}</strong>${data.postcode ? ` · ${esc(data.postcode)}` : ""}</p>
     ${data.held ? `<p style="margin:0 0 12px;color:#9B1C1C;"><strong>Held for a check</strong> (over the hold amount). Check it before packing.</p>` : ""}
     <ul style="margin:0 0 12px;padding-left:18px;">${items.map((i) => `<li>${esc(i.qty)} × ${esc(i.name)}</li>`).join("")}</ul>
     ${btn(adminUrl, "Open orders")}`,
  );
}

function adminLowStockEmail(data: Record<string, unknown>): string {
  const items = (data.items as { name: string; stock: number; threshold: number }[] | undefined) ?? [];
  const adminUrl = `${process.env.APP_URL ?? "https://tova-ster.com"}/admin/products`;
  return shell(
    "Low stock",
    `<h1 style="font-size:20px;margin:0 0 8px;">Low stock</h1>
     <p style="color:${BRAND_MUTED};margin:0 0 12px;">Order ${esc(data.orderNumber)} took these down to their low-stock level:</p>
     <ul style="margin:0 0 12px;padding-left:18px;">${items.map((i) => `<li><strong>${esc(i.name)}</strong>: ${esc(i.stock)} left (alert level ${esc(i.threshold)})</li>`).join("")}</ul>
     ${btn(adminUrl, "Open products")}`,
  );
}

function birthdayEmail(data: Record<string, unknown>): string {
  const name = str(data, "firstName");
  const points = Number(data.points) || 0;
  const pounds = Number(data.pounds) || 0;
  const appUrl = process.env.APP_URL ?? "https://tova-ster.com";
  return shell(
    "Happy birthday from Tova-Ster",
    `<h1 style="font-size:22px;margin:0 0 8px;">Happy birthday${name ? `, ${esc(name)}` : ""}!</h1>
     <p style="color:${BRAND_MUTED};margin:0 0 16px;">From all of us at Tova-Ster, we hope you have a lovely day.</p>
     ${points > 0 ? `<p style="margin:0 0 8px;">We've added <strong>${points} points</strong> to your account, worth <strong>£${pounds.toFixed(2)}</strong> off your next order.</p>` : ""}
     ${btn(`${appUrl}/shop`, points > 0 ? "Treat yourself" : "Visit the shop")}
     <p style="font-size:12px;color:${BRAND_MUTED};margin:16px 0 0;">You're getting this because you added your birthday to your Tova-Ster account. You can remove it in your account details at any time.</p>`,
  );
}

function freebieEmail(data: Record<string, unknown>): string {
  const link = str(data, "link");
  const code = str(data, "code");
  const pct = str(data, "pct");
  return shell(
    "Your free guide",
    `<h1 style="font-size:22px;margin:0 0 16px;">Here's your free guide</h1>
     <p style="color:${BRAND_MUTED};line-height:1.6;margin:0 0 8px;">${esc(str(data, "title"))}. Tap the button to download it. The link keeps working, so you can come back to it.</p>
     <div style="text-align:center;">${btn(link, "Download the guide")}</div>
     ${code ? `<p style="line-height:1.6;margin:8px 0 0;">As a thank you, use <b style="color:${BRAND_GOLD};">${esc(code)}</b> for ${esc(pct)}% off your first order at tova-ster.com.</p>` : ""}
     <p style="color:${BRAND_MUTED};font-size:12px;margin-top:24px;">You're getting this because you asked for the guide and agreed to hear from us. Unsubscribe any time from the link in our emails.</p>`,
  );
}

function verificationEmail(data: Record<string, unknown>): string {
  const firstName = str(data, "firstName", "there");
  const link = str(data, "link");
  return shell(
    "Verify your email",
    `<h1 style="font-size:22px;margin:0 0 16px;">Hi ${esc(firstName)}, verify your email</h1>
     <p style="color:${BRAND_MUTED};line-height:1.6;margin:0 0 24px;">
       Thanks for creating an account. Click the button below to verify your email address.
       This link expires in 24 hours.
     </p>
     <div style="text-align:center;">${btn(link, "Verify email address")}</div>
     <p style="color:${BRAND_MUTED};font-size:13px;margin-top:24px;">
       Or copy this link into your browser:<br>
       <a href="${esc(link)}" style="color:${BRAND_GOLD};word-break:break-all;">${esc(link)}</a>
     </p>
     <p style="color:${BRAND_MUTED};font-size:12px;margin-top:16px;">If you didn't create an account, you can ignore this email.</p>`,
  );
}

function passwordResetEmail(data: Record<string, unknown>): string {
  const firstName = str(data, "firstName", "there");
  const link = str(data, "link");
  return shell(
    "Reset your password",
    `<h1 style="font-size:22px;margin:0 0 16px;">Password reset request</h1>
     <p style="color:${BRAND_MUTED};line-height:1.6;margin:0 0 24px;">
       Hi ${esc(firstName)}, we received a request to reset your password.
       Click the button below — the link expires in 1 hour.
     </p>
     <div style="text-align:center;">${btn(link, "Reset password")}</div>
     <p style="color:${BRAND_MUTED};font-size:13px;margin-top:24px;">
       Or copy this link:<br>
       <a href="${esc(link)}" style="color:${BRAND_GOLD};word-break:break-all;">${esc(link)}</a>
     </p>
     <p style="color:${BRAND_MUTED};font-size:12px;margin-top:16px;">If you didn't request a reset, no action is needed — your password hasn't changed.</p>`,
  );
}

function adminInviteEmail(data: Record<string, unknown>): string {
  const name = str(data, "name", "there");
  const role = str(data, "role");
  const by = str(data, "invitedBy", "The Tova-Ster owner");
  const link = str(data, "link");
  return shell(
    "You're invited to the Tova-Ster admin",
    `<h1 style="font-size:22px;margin:0 0 16px;">Join the Tova-Ster team</h1>
     <p style="color:${BRAND_MUTED};line-height:1.6;margin:0 0 24px;">
       Hi ${esc(name)}, ${esc(by)} has added you to the shop admin as <b>${esc(role)}</b>.
       Choose your password to get started. The link works once and expires in 48 hours.
     </p>
     <div style="text-align:center;">${btn(link, "Choose my password")}</div>
     <p style="color:${BRAND_MUTED};font-size:13px;margin-top:24px;">
       Or copy this link:<br>
       <a href="${esc(link)}" style="color:${BRAND_GOLD};word-break:break-all;">${esc(link)}</a>
     </p>
     <p style="color:${BRAND_MUTED};font-size:12px;margin-top:16px;">If you weren't expecting this, ignore this email.</p>`,
  );
}

function orderConfirmationEmail(data: Record<string, unknown>): string {
  const orderNumber = str(data, "orderNumber");
  const total = Number(data.total ?? 0);
  const items = (data.items as Array<{ name: string; qty: number; price: number }>) ?? [];
  const shippingState = str(data, "shippingState");

  const itemRows = items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #F3EEE3;font-size:14px;">${esc(i.name)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #F3EEE3;font-size:14px;text-align:right;">× ${i.qty}</td>
          <td style="padding:8px 0;border-bottom:1px solid #F3EEE3;font-size:14px;text-align:right;font-weight:600;">£${(i.price * i.qty).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`,
    )
    .join("");

  return shell(
    `Order ${orderNumber} confirmed`,
    `<h1 style="font-size:22px;margin:0 0 8px;">Your order is confirmed 🎉</h1>
     <p style="color:${BRAND_MUTED};margin:0 0 24px;">Order <strong>${esc(orderNumber)}</strong> — payment received.</p>

     ${
       items.length
         ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
              <thead><tr>
                <th style="text-align:left;font-size:12px;text-transform:uppercase;color:${BRAND_MUTED};padding-bottom:8px;border-bottom:1px solid #E7DFCF;">Item</th>
                <th style="text-align:right;font-size:12px;text-transform:uppercase;color:${BRAND_MUTED};padding-bottom:8px;border-bottom:1px solid #E7DFCF;">Qty</th>
                <th style="text-align:right;font-size:12px;text-transform:uppercase;color:${BRAND_MUTED};padding-bottom:8px;border-bottom:1px solid #E7DFCF;">Amount</th>
              </tr></thead>
              <tbody>${itemRows}</tbody>
              <tfoot><tr>
                <td colspan="2" style="padding-top:12px;font-weight:700;">Total</td>
                <td style="padding-top:12px;font-weight:700;text-align:right;">£${total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr></tfoot>
            </table>`
         : `<p style="font-weight:700;">Total: £${total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>`
     }

     ${shippingState ? `<p style="color:${BRAND_MUTED};font-size:14px;">Shipping to: <strong>${esc(shippingState)}</strong></p>` : ""}

     <div style="background:#F3EEE3;border-radius:8px;padding:16px;margin-top:20px;font-size:14px;color:${BRAND_MUTED};">
       We'll send another email when your order ships. If you have questions, reply to this email or contact our support team.
     </div>`,
  );
}

function orderShippedEmail(data: Record<string, unknown>): string {
  const orderNumber = str(data, "orderNumber");
  const trackingCode = str(data, "trackingCode");
  const courierName = str(data, "courierName");

  return shell(
    `Order ${orderNumber} has shipped`,
    `<h1 style="font-size:22px;margin:0 0 8px;">Your order is on its way! 🚚</h1>
     <p style="color:${BRAND_MUTED};margin:0 0 24px;">Order <strong>${esc(orderNumber)}</strong> has been dispatched and is heading to you.</p>

     ${
       trackingCode
         ? `<div style="background:#F3EEE3;border-radius:8px;padding:16px;margin-bottom:20px;">
              <p style="margin:0;font-size:13px;color:${BRAND_MUTED};text-transform:uppercase;letter-spacing:0.06em;">Tracking</p>
              <p style="margin:4px 0 0;font-weight:700;font-size:16px;">${esc(trackingCode)}</p>
              ${courierName ? `<p style="margin:4px 0 0;font-size:13px;color:${BRAND_MUTED};">via ${esc(courierName)}</p>` : ""}
            </div>`
         : ""
     }

     <p style="color:${BRAND_MUTED};font-size:14px;line-height:1.6;">
       Most deliveries arrive within 1–5 business days depending on your location.
       If your order hasn't arrived after 7 business days, please reach out to us.
     </p>`,
  );
}

function orderStatusUpdateEmail(data: Record<string, unknown>): string {
  const orderNumber = str(data, "orderNumber");
  const newStatus = str(data, "status");
  const statusLabel = str(data, "statusLabel", newStatus);

  return shell(
    `Order ${orderNumber} update`,
    `<h1 style="font-size:22px;margin:0 0 8px;">Order update</h1>
     <p style="color:${BRAND_MUTED};margin:0 0 16px;">Order <strong>${esc(orderNumber)}</strong></p>
     <div style="background:#F3EEE3;border-radius:8px;padding:16px;display:inline-block;">
       <p style="margin:0;font-size:13px;color:${BRAND_MUTED};text-transform:uppercase;letter-spacing:0.06em;">New status</p>
       <p style="margin:4px 0 0;font-weight:700;font-size:18px;">${esc(statusLabel)}</p>
     </div>`,
  );
}

function genericEmail(data: Record<string, unknown>): string {
  return shell(
    "Message from Wellness Co.",
    `<p style="color:${BRAND_MUTED};line-height:1.6;">${esc(JSON.stringify(data))}</p>`,
  );
}
