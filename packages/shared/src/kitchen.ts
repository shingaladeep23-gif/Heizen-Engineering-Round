// The kitchen board: one row per prep unit (a combination on an order line).

export type UnitState = 'waiting' | 'todo' | 'at-risk' | 'late' | 'cooking' | 'done';

export type KitchenUnit = {
  id: number;
  orderId: number;
  orderStatus: 'PLACED' | 'CONFIRMED' | 'DELIVERED';
  company: string;
  deliveryTime: string;
  kitchenReadyBy: string; // planned, worked back from the delivery time
  station: string; // "Unassigned" when the dish has no station
  dishName: string;
  quantity: number;
  choices: string;
  startedAt: string | null;
  doneAt: string | null;
  state: UnitState;
};

export type KitchenBoard = { date: string; generatedAt: string; units: KitchenUnit[] };
