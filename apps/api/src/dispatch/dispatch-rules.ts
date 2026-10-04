// Dispatch rules (spec 4.8), kept pure so they're easy to test.
import type { DropStage, DropStep } from '@fernleaf/shared';

export type Progress = {
  kitchenReadyAt: Date | null;
  dispatchReadyAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  driverId: number | null;
};

// Each step, the timestamp it sets, and the step that must come before it.
const STEPS: Record<DropStep, { field: keyof Progress; after: keyof Progress; was: string }> = {
  'dispatch-ready': { field: 'dispatchReadyAt', after: 'kitchenReadyAt', was: 'cooked' },
  out: { field: 'outForDeliveryAt', after: 'dispatchReadyAt', was: 'ready for dispatch' },
  delivered: { field: 'deliveredAt', after: 'outForDeliveryAt', was: 'out for delivery' },
};

/** A drop is only as far along as its slowest order. */
export function stageOf(orders: Progress[]): DropStage {
  const all = (field: keyof Progress) => orders.every((o) => o[field] !== null);
  if (all('deliveredAt')) return 'delivered';
  if (all('outForDeliveryAt')) return 'out';
  if (all('dispatchReadyAt')) return 'dispatch-ready';
  if (all('kitchenReadyAt')) return 'kitchen-ready';
  return 'cooking';
}

/**
 * Why a step can't happen yet, or null if it can. Each step needs the one
 * before it on every order, can't be repeated, and "out for delivery" also
 * needs one driver for the whole drop.
 */
export function stepProblem(orders: Progress[], step: DropStep): string | null {
  const { field, after, was } = STEPS[step];
  if (orders.every((o) => o[field] !== null)) return 'That step is already done for this drop';
  const behind = orders.filter((o) => o[after] === null).length;
  if (behind) return `${behind} of ${orders.length} orders aren't ${was} yet`;
  if (step === 'out') {
    if (orders.some((o) => o.driverId === null)) return 'Assign a driver first';
    // An admin can move an order into a drop that has another driver. One drop,
    // one driver: otherwise each driver would see half of it.
    if (new Set(orders.map((o) => o.driverId)).size > 1) {
      return 'The orders in this drop have different drivers; pick one driver for the drop';
    }
  }
  return null;
}

export const stepField = (step: DropStep) => STEPS[step].field;

// On time = delivered no later than the delivery time plus the grace period.
export const deliveredOnTime = (deliveredAt: Date, deliverAt: Date, graceMinutes: number) =>
  deliveredAt.getTime() <= deliverAt.getTime() + graceMinutes * 60_000;
