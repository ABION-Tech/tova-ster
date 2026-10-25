import { getAllSettings } from "../settings/settingsRepo.js";
import type { PricingFeatures } from "./engine.js";
import type { DeliveryRates } from "../services/delivery/index.js";

/** The slice of admin settings the pricing engine needs. */
export async function pricingContext(): Promise<{ features: PricingFeatures; rates: DeliveryRates; vat: number }> {
  const s = await getAllSettings();
  const f = s.features;
  return {
    features: {
      freeDelivery: { on: f.freeDelivery.on, threshold: Number(f.freeDelivery.threshold) },
      subscribe: { on: f.subscribe.on, discount: Number(f.subscribe.discount) },
      multibuy: { on: f.multibuy.on, mode: f.multibuy.mode },
      bundles: { on: f.bundles.on },
      quiz: { on: f.quiz.on, discount: Number(f.quiz.discount) },
      codes: { on: f.codes.on },
      rewards: { on: f.rewards.on, earn: Number(f.rewards.earn), pointValue: Number(f.rewards.pointValue), minRedeem: Number(f.rewards.minRedeem) },
    },
    rates: {
      mainland: Number(s.delivery.mainland),
      highlands: Number(s.delivery.highlands),
      ni: Number(s.delivery.ni),
      threshold: f.freeDelivery.on ? Number(f.freeDelivery.threshold) : null,
    },
    vat: Number(s.delivery.vat),
  };
}
