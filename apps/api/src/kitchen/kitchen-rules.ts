import type { UnitState } from '@fernleaf/shared';

/**
 * How urgent a prep unit is. Placed (not yet confirmed) orders can't be
 * worked on yet. Unfinished work is late once its planned kitchen-ready time
 * has passed, and at risk within `atRiskMinutes` of it.
 */
export function unitState(
  unit: { startedAt: Date | null; doneAt: Date | null },
  confirmed: boolean,
  kitchenReadyBy: Date,
  now: Date,
  atRiskMinutes: number,
): UnitState {
  if (unit.doneAt) return 'done';
  if (!confirmed) return 'waiting';
  if (now >= kitchenReadyBy) return 'late';
  if (now.getTime() >= kitchenReadyBy.getTime() - atRiskMinutes * 60_000) return 'at-risk';
  return unit.startedAt ? 'cooking' : 'todo';
}
