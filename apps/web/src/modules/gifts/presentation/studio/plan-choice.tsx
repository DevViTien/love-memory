"use client";

import { type PlanOfferDto } from "@love-memory/contracts";

import { formatPhotoLimit, formatPlanPrice, formatRetention, formatWatermark } from "./plan-format";

export const PLAN_CHOICE_MESSAGES = {
  internalGrant: "Cấp nội bộ để thử nghiệm, không thu phí.",
  notAvailable: "Sắp mở thanh toán.",
  tooManyPhotos: (photoCount: number, maxPhotos: number) =>
    `Món quà đang có ${photoCount} ảnh, gói này cho tối đa ${maxPhotos} ảnh.`,
} as const;

export type PlanOption = Readonly<{
  /** Why the option cannot be chosen, the first case that applies; `null` when it can. */
  disabledReason: string | null;
  offer: PlanOfferDto;
}>;

/** Each offer with its disabled explanation for a draft holding `photoCount` photos. */
export function planOptions(offers: readonly PlanOfferDto[], photoCount: number): PlanOption[] {
  return offers.map((offer) => {
    let disabledReason: string | null = null;
    if (!offer.available) {
      disabledReason = PLAN_CHOICE_MESSAGES.notAvailable;
    } else if (offer.maxPhotos !== null && photoCount > offer.maxPhotos) {
      disabledReason = PLAN_CHOICE_MESSAGES.tooManyPhotos(photoCount, offer.maxPhotos);
    }
    return { disabledReason, offer };
  });
}

/**
 * The selected plan: the creator's choice while it can be chosen, otherwise the first option that
 * can, otherwise none.
 */
export function selectedPlan(
  options: readonly PlanOption[],
  chosen: string | null,
): PlanOfferDto | null {
  const enabled = options.filter((option) => option.disabledReason === null);
  return (
    enabled.find((option) => option.offer.planId === chosen)?.offer ?? enabled[0]?.offer ?? null
  );
}

/** The `Chọn gói` radio group of a draft's `Xuất bản` step, built from the server's offers. */
export function PlanChoice({
  disabled,
  onSelect,
  options,
  selectedPlanId,
}: Readonly<{
  disabled: boolean;
  onSelect: (planId: PlanOfferDto["planId"]) => void;
  options: readonly PlanOption[];
  selectedPlanId: string | null;
}>) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-stone-700">Chọn gói</legend>
      {options.map(({ disabledReason, offer }) => {
        const id = `studio-plan-${offer.planId}`;
        const optionDisabled = disabled || disabledReason !== null;
        return (
          <label
            className={`flex gap-3 rounded-2xl border p-4 ${
              selectedPlanId === offer.planId
                ? "border-rose-300 bg-rose-50/70"
                : "border-stone-200 bg-white"
            } ${optionDisabled ? "opacity-70" : "cursor-pointer"}`}
            htmlFor={id}
            key={offer.planId}
          >
            <input
              aria-describedby={`${id}-details`}
              checked={selectedPlanId === offer.planId}
              className="mt-1"
              disabled={optionDisabled}
              id={id}
              name="studio-plan"
              onChange={() => onSelect(offer.planId)}
              type="radio"
              value={offer.planId}
            />
            <span className="space-y-1">
              <span className="block text-base font-black text-stone-900">
                {offer.name} · {formatPlanPrice(offer.priceVnd)}
              </span>
              <span className="block text-sm text-stone-700" id={`${id}-details`}>
                {formatPhotoLimit(offer.maxPhotos)} · {formatWatermark(offer.watermark)} ·{" "}
                {formatRetention(offer.retentionDays)}
                {disabledReason ? (
                  <span className="mt-1 block font-semibold text-stone-600">{disabledReason}</span>
                ) : offer.internalGrant ? (
                  <span className="mt-1 block font-semibold text-amber-800">
                    {PLAN_CHOICE_MESSAGES.internalGrant}
                  </span>
                ) : null}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
