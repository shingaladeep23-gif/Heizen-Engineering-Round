import { BILLABLE, creditLeft, invoiceTotal } from './billing-rules.js';

describe('billing rules', () => {
  it('bills confirmed and delivered orders, and nothing that is not final or not going ahead', () => {
    const billable = (status: string) => (BILLABLE as readonly string[]).includes(status);
    expect(['CONFIRMED', 'DELIVERED'].every(billable)).toBe(true);
    expect(['DRAFT', 'PLACED', 'CANCELLED', 'REJECTED'].some(billable)).toBe(false);
  });

  it('totals an invoice as its orders plus its credits', () => {
    expect(invoiceTotal([{ total: 21900 }, { total: 18000 }], [{ amount: -5000 }])).toBe(34900);
    expect(invoiceTotal([], [{ amount: -2000 }])).toBe(-2000); // a credit note on its own
  });

  it('never lets credits exceed what the order cost', () => {
    expect(creditLeft(20000, [])).toBe(20000);
    expect(creditLeft(20000, [{ amount: -15000 }])).toBe(5000);
    expect(creditLeft(20000, [{ amount: -20000 }])).toBe(0);
  });

  it('credits only what is left when a short delivery is later cancelled', () => {
    // ₹200 order, ₹50 credited for a missing box, then cancelled after invoicing:
    // the cancel credits the remaining ₹150, so the order nets to zero, never below.
    const earlier = [{ amount: -5000 }];
    const cancelCredit = -creditLeft(20000, earlier);
    expect(cancelCredit).toBe(-15000);
    expect(invoiceTotal([{ total: 20000 }], [...earlier, { amount: cancelCredit }])).toBe(0);
    expect(creditLeft(20000, [...earlier, { amount: cancelCredit }])).toBe(0);
  });
});
