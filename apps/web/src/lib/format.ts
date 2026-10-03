import type { OrderStatus } from '@fernleaf/shared';

// The kitchen runs on IST, so times are always shown in IST, whatever time
// zone the browser is in.
const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC', // 'YYYY-MM-DD' parses as UTC midnight; keep it that day
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
// A delivery time stored as "HH:mm" (IST), shown like every other time: "3:30 am".
export const formatClock = (hhmm: string) => formatTime(`2000-01-01T${hhmm}:00+05:30`);
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const formatDay = (day: string) => dayFmt.format(new Date(day));

export const STATUS_COLORS: Record<OrderStatus, string> = {
  DRAFT: 'gray',
  PLACED: 'blue',
  CONFIRMED: 'teal',
  DELIVERED: 'green',
  CANCELLED: 'dark',
  REJECTED: 'red',
};

export const statusLabel = (status: OrderStatus) =>
  status.charAt(0) + status.slice(1).toLowerCase();

// Today's date in IST as 'YYYY-MM-DD' (or n days from today), whatever the
// browser's own time zone is.
export const todayIST = (plusDays = 0) =>
  new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
