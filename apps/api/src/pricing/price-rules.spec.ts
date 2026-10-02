import { applyFactor, resolvePrice, roundUpTo5, tierIdFor, type TierRule } from './price-rules.js';

const STANDARD: TierRule = {
  id: 1,
  base: null,
  baseTierId: null,
  factor: null,
};
const ENTERPRISE: TierRule = {
  id: 2,
  base: 'TIER',
  baseTierId: 1,
  factor: '1.15',
};
const PARTNER: TierRule = {
  id: 3,
  base: 'COST',
  baseTierId: null,
  factor: '2.4',
};

describe('rounding', () => {
  it('rounds up to the next 5 paise, like the spec example ($2.11 -> $2.15)', () => {
    expect(roundUpTo5(211)).toBe(215);
    expect(roundUpTo5(215)).toBe(215);
    expect(roundUpTo5(216)).toBe(220);
  });

  it('applies factors without floating point drift', () => {
    expect(applyFactor(10000, '1.15')).toBe(11500); // 1.15 isn't exact in binary
    expect(applyFactor(211, '1')).toBe(215);
    expect(applyFactor(4999, '2.4')).toBe(12000); // 11997.6 -> 12000
    expect(applyFactor(3333, '0.9')).toBe(3000); // 2999.7 -> 3000
  });
});

describe('resolvePrice', () => {
  const typed = new Map([[1, 20000]]); // ₹200 typed on Standard

  it('uses the typed price on a typed-in tier', () => {
    expect(resolvePrice(STANDARD, typed, 8000)).toBe(20000);
  });

  it('returns null when a typed-in tier has no price, so the item is hidden', () => {
    expect(resolvePrice(STANDARD, new Map(), 8000)).toBeNull();
  });

  it('derives from another tier ("Standard + 15%")', () => {
    expect(resolvePrice(ENTERPRISE, typed, 8000)).toBe(23000);
  });

  it('derives from cost ("cost x 2.4")', () => {
    expect(resolvePrice(PARTNER, new Map(), 8000)).toBe(19200);
  });

  it('lets a typed override beat the formula', () => {
    const withOverride = new Map([...typed, [2, 21000]]);
    expect(resolvePrice(ENTERPRISE, withOverride, 8000)).toBe(21000);
  });

  it('has no price when the base tier has none', () => {
    expect(resolvePrice(ENTERPRISE, new Map(), 8000)).toBeNull();
  });

  it('never turns a zero cost into a free item', () => {
    expect(resolvePrice(PARTNER, new Map(), 0)).toBeNull();
  });
});

describe('tierIdFor', () => {
  it("uses the company's tier, else the default", () => {
    expect(tierIdFor(3, 1)).toBe(3);
    expect(tierIdFor(null, 1)).toBe(1);
  });
});
