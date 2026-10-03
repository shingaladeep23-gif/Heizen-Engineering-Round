import { unitState } from './kitchen-rules.js';

const READY_BY = new Date('2026-10-07T05:30:00Z'); // 11:00 IST
const minutesBefore = (m: number) => new Date(READY_BY.getTime() - m * 60_000);
const fresh = { startedAt: null, doneAt: null };

describe('unitState', () => {
  it('is waiting while the order is only placed', () => {
    expect(unitState(fresh, false, READY_BY, minutesBefore(5), 30)).toBe('waiting');
  });

  it('is to-do, then at risk inside the window, then late', () => {
    expect(unitState(fresh, true, READY_BY, minutesBefore(45), 30)).toBe('todo');
    expect(unitState(fresh, true, READY_BY, minutesBefore(30), 30)).toBe('at-risk');
    expect(unitState(fresh, true, READY_BY, READY_BY, 30)).toBe('late');
  });

  it('shows started work as cooking until it gets close', () => {
    const started = { startedAt: minutesBefore(50), doneAt: null };
    expect(unitState(started, true, READY_BY, minutesBefore(40), 30)).toBe('cooking');
    expect(unitState(started, true, READY_BY, minutesBefore(10), 30)).toBe('at-risk');
  });

  it('is done once finished, however late', () => {
    const done = { startedAt: minutesBefore(20), doneAt: minutesBefore(-15) };
    expect(unitState(done, true, READY_BY, minutesBefore(-60), 30)).toBe('done');
  });
});
