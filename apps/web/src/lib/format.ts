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
