// All money is whole paise (₹1 = 100 paise). Floats never hold a price.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export const formatMoney = (paise: number) => inr.format(paise / 100);

// For form inputs typed in rupees, e.g. 249.5 -> 24950.
export const toPaise = (rupees: number) => Math.round(rupees * 100);
