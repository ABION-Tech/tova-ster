import type { Features } from "../../lib/tova/types";

const MARKS = [
  { k: "visa", label: "Visa", on: (p: Features["payments"]) => p.card },
  { k: "mastercard", label: "Mastercard", on: (p: Features["payments"]) => p.card },
  { k: "amex", label: "American Express", on: (p: Features["payments"]) => p.card },
  { k: "apple-pay", label: "Apple Pay", on: (p: Features["payments"]) => p.applePay },
  { k: "google-pay", label: "Google Pay", on: (p: Features["payments"]) => p.googlePay },
  { k: "paypal", label: "PayPal", on: (p: Features["payments"]) => p.paypal },
];

/** Official acceptance marks for the payment methods switched on in the admin. */
export function PayMarks({ payments, label = "Ways to pay" }: { payments: Features["payments"]; label?: string }) {
  return (
    <div className="paymarks" role="list" aria-label={label}>
      {MARKS.filter((m) => m.on(payments)).map((m) => (
        // eslint-disable-next-line @next/next/no-img-element
        <span key={m.k} role="listitem" className={`paymark ${m.k}`}><img src={`/pay/${m.k}.svg`} alt={m.label} width={40} height={22} /></span>
      ))}
      {payments.klarna && <span role="listitem" className="paymark text">Klarna</span>}
    </div>
  );
}
