// Pricing rules (spec 4.3), kept free of the database so they're easy to test.

export type TierRule = {
  id: number;
  base: 'COST' | 'TIER' | null; // null = prices are typed in
  baseTierId: number | null;
  factor: string | null; // decimal string from Postgres, e.g. "2.4" or "1.15"
};

// Derived prices round up to the next 5 paise (spec: $2.11 becomes $2.15).
export const roundUpTo5 = (paise: number) => Math.ceil(paise / 5) * 5;

export function applyFactor(base: number, factor: string) {
  // Scale the factor to a whole number first ("1.15" -> 11500), so the only
  // division left is the final rounding step.
  const factorTimes10k = Math.round(Number(factor) * 10_000);
  return Math.ceil((base * factorTimes10k) / 50_000) * 5;
}

/**
 * The price of one dish or option on one tier, or null if it isn't sold there.
 * `typed` holds the prices staff typed in, keyed by tier id. On a derived tier
 * a typed price is an override and wins over the formula.
 */
export function resolvePrice(
  tier: TierRule,
  typed: ReadonlyMap<number, number>,
  cost: number,
): number | null {
  const own = typed.get(tier.id);
  if (own !== undefined) return own;
  if (!tier.base || !tier.factor) return null;

  const base = tier.base === 'COST' ? cost : typed.get(tier.baseTierId ?? -1);
  if (base === undefined) return null;
  const price = applyFactor(base, tier.factor);
  return price > 0 ? price : null; // a zero cost must not turn into a ₹0 price
}

// An employee is priced on their company's tier, or the default if it has none.
export const tierIdFor = (companyTierId: number | null, defaultTierId: number | null) =>
  companyTierId ?? defaultTierId;

export const pricesByTier = (rows: { tierId: number; price: number }[]) =>
  new Map(rows.map((row) => [row.tierId, row.price]));

/**
 * A portion size's extra charge on a tier (D75). It's entered as the default
 * tier's price and scales by the same proportion as the option's own price:
 * if paneer is 10% cheaper on a tier, so is its Large extra. Rounded up to
 * 5 paise like every derived price. With no default price to compare with,
 * the charge stays as entered.
 */
export function scaleExtra(extra: number, tierPrice: number, defaultPrice: number | null) {
  if (!defaultPrice || extra === 0 || tierPrice === defaultPrice) return extra;
  return Math.ceil((extra * tierPrice) / (defaultPrice * 5)) * 5;
}
