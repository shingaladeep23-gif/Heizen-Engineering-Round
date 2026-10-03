import { cutoffFor, istInstant, plannedTimes, todayIST, type Calendar } from './calendar.js';

const MON_TO_FRI: Calendar = { workingDays: [1, 2, 3, 4, 5], holidays: new Set() };

describe('cutoffFor', () => {
  // 7 Oct 2026 is a Wednesday.
  it('matches the spec example: 2 working days at 16:00, Wednesday locks Monday 16:00', () => {
    expect(cutoffFor('2026-10-07', MON_TO_FRI, 2, '16:00')).toEqual(
      istInstant('2026-10-05', '16:00'),
    );
  });

  it('skips the weekend when counting back', () => {
    // Monday 5 Oct -> Friday (1), Thursday (2)
    expect(cutoffFor('2026-10-05', MON_TO_FRI, 2, '16:00')).toEqual(
      istInstant('2026-10-01', '16:00'),
    );
  });

  it('skips kitchen holidays when counting back', () => {
    const withHoliday = { ...MON_TO_FRI, holidays: new Set(['2026-10-05']) };
    // Wednesday 7 Oct -> Tuesday (1), Monday is a holiday, Friday (2)
    expect(cutoffFor('2026-10-07', withHoliday, 2, '16:00')).toEqual(
      istInstant('2026-10-02', '16:00'),
    );
  });

  it('allows a same-day cut-off', () => {
    expect(cutoffFor('2026-10-07', MON_TO_FRI, 0, '09:00')).toEqual(
      istInstant('2026-10-07', '09:00'),
    );
  });

  it('refuses to loop forever if the kitchen never works', () => {
    expect(() =>
      cutoffFor('2026-10-07', { workingDays: [], holidays: new Set() }, 1, '16:00'),
    ).toThrow();
  });
});

describe('IST conversions', () => {
  it('turns an IST wall-clock time into the right instant', () => {
    expect(istInstant('2026-10-05', '16:00').toISOString()).toBe('2026-10-05T10:30:00.000Z');
  });

  it('knows "today" in IST even when UTC is still on the day before', () => {
    // 20:00 UTC on 4 Oct is 01:30 IST on 5 Oct.
    expect(todayIST(new Date('2026-10-04T20:00:00Z'))).toBe('2026-10-05');
  });
});

describe('plannedTimes', () => {
  it('works back from delivery: dispatch = delivery - lead, kitchen = dispatch - buffer', () => {
    const plan = plannedTimes('2026-10-07', '12:30', 60, 30);
    expect(plan.dispatchReadyBy).toEqual(istInstant('2026-10-07', '11:30'));
    expect(plan.kitchenReadyBy).toEqual(istInstant('2026-10-07', '11:00'));
  });
});
