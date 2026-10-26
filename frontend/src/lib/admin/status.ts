/** Order status words and pill colours used across the admin (demo wording). */
export const STATUS: Record<string, [string, string]> = {
  PENDING_PAYMENT: ["Awaiting payment", "pending"],
  PAID: ["Paid, to pack", "paid"],
  PROCESSING: ["Packed", "processing"],
  SHIPPED: ["Dispatched", "shipped"],
  DELIVERED: ["Delivered", "delivered"],
  CANCELLED: ["Cancelled", "cancelled"],
  REFUNDED: ["Refunded", "refunded"],
};
export const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
