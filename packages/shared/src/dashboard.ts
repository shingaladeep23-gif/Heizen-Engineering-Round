// The admin dashboard. Every figure is defined in the README (spec 4.11).

export type AdminDashboard = {
  today: {
    date: string;
    orders: number; // confirmed + delivered for today
    value: number; // their totals, paise
    delivered: number;
    lateDrops: number;
  };
  upcoming: {
    // tomorrow to 7 days out
    confirmed: number;
    placed: number;
    drafts: number;
    value: number; // confirmed + placed
  };
  money: {
    unbilled: number; // billable orders + credits not on an invoice
    unpaid: number;
    unpaidInvoices: number;
    overdueInvoices: number; // unpaid for more than 14 days
    paidLast30Days: number;
  };
  lastWeek: {
    from: string;
    to: string;
    orders: number; // confirmed + delivered
    revenue: number;
    delivered: number;
    onTime: number;
    cancelled: number;
    rejected: number;
  };
  topDishes: { name: string; portions: number }[];
  tiersMissingPrices: { name: string; missing: number }[];
};
