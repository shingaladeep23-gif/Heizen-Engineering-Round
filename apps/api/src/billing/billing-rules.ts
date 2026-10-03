// Billing rules (spec 4.9, D7), pure so they're easy to test.

// Confirmed orders are owed in full by the company; delivered ones too.
// Cancelled, rejected and not-yet-confirmed orders are not.
export const BILLABLE = ['CONFIRMED', 'DELIVERED'] as const;

// An invoice is its orders plus its credits (negative). Stored when the
// invoice is created and never recalculated.
export const invoiceTotal = (orders: { total: number }[], credits: { amount: number }[]) =>
  orders.reduce((sum, o) => sum + o.total, 0) + credits.reduce((sum, c) => sum + c.amount, 0);

/** How much more can still be credited back on an order: never more than was charged. */
export const creditLeft = (orderTotal: number, credits: { amount: number }[]) =>
  orderTotal + credits.reduce((sum, c) => sum + c.amount, 0);
