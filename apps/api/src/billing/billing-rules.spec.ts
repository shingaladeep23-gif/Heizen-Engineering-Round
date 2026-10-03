import { BILLABLE, creditLeft, invoiceTotal } from './billing-rules.js';

describe('billing rules', () => {
  it('bills confirmed and delivered orders only', () => {
    expect(BILLABLE).toEqual(['CONFIRMED', 'DELIVERED']);
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
});
