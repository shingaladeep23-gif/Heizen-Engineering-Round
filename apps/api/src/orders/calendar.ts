// Dates and times for a kitchen in India. IST is UTC+5:30 all year (no
// daylight saving), so converting is one constant. Everything here uses UTC
// arithmetic only, so the server's own time zone never matters.

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export type Day = string; // a calendar date in IST, 'YYYY-MM-DD'

export const todayIST = (now = new Date()): Day =>
  new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export const addDays = (day: Day, n: number): Day =>
  new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

export const isoWeekday = (day: Day) => new Date(day).getUTCDay() || 7; // 1 = Mon ... 7 = Sun

// The moment a given IST date and "HH:mm" time happens.
export const istInstant = (day: Day, time: string) =>
  new Date(Date.parse(`${day}T${time}:00Z`) - IST_OFFSET_MS);

// Postgres DATE columns come back as UTC midnight.
export const dayOf = (date: Date): Day => date.toISOString().slice(0, 10);

// For messages: "Sun 4 Oct, 4:00 pm IST", whatever the server's own zone.
const istFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
export const istLabel = (instant: Date) => `${istFormat.format(instant)} IST`;
const dayFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC', // a Day parses as UTC midnight; keep it that day
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
export const dayLabel = (day: Day) => dayFormat.format(new Date(day));

export const minutesBefore = (instant: Date, minutes: number) =>
  new Date(instant.getTime() - minutes * 60_000);

export type Calendar = { workingDays: number[]; holidays: Set<Day> };

export const isOpen = (calendar: Calendar, day: Day) =>
  calendar.workingDays.includes(isoWeekday(day)) && !calendar.holidays.has(day);

/**
 * Orders for `delivery` lock at `cutoffTime`, `cutoffDays` kitchen working
 * days before it (spec 4.6). Kitchen holidays and days off are skipped when
 * counting back. The company calendar plays no part here.
 */
export function cutoffFor(
  delivery: Day,
  kitchen: Calendar,
  cutoffDays: number,
  cutoffTime: string,
) {
  let day = delivery;
  for (let counted = 0, steps = 0; counted < cutoffDays; steps++) {
    if (steps > 366) throw new Error('The kitchen has no working days to count back through');
    day = addDays(day, -1);
    if (isOpen(kitchen, day)) counted++;
  }
  return istInstant(day, cutoffTime);
}

/**
 * Work back from the delivery time (spec 4.7): the order must leave the
 * kitchen `dispatchLeadMinutes` before delivery, and be cooked
 * `kitchenBufferMinutes` before that.
 */
export function plannedTimes(
  day: Day,
  deliveryTime: string,
  dispatchLeadMinutes: number,
  kitchenBufferMinutes: number,
) {
  const deliverAt = istInstant(day, deliveryTime);
  const dispatchReadyBy = minutesBefore(deliverAt, dispatchLeadMinutes);
  return {
    deliverAt,
    dispatchReadyBy,
    kitchenReadyBy: minutesBefore(dispatchReadyBy, kitchenBufferMinutes),
  };
}
