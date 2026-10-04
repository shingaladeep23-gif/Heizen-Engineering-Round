import { describe, expect, it } from 'vitest';
import { IdPipe } from './id.pipe.js';

const meta = { type: 'query' as const, data: 'employeeId' };
const statusOf = (run: () => unknown) => {
  try {
    run();
    return 200;
  } catch (error) {
    return (error as { getStatus(): number }).getStatus();
  }
};

describe('IdPipe', () => {
  it('turns a good id into a number', () => {
    expect(new IdPipe().transform('42', meta)).toBe(42);
  });

  it("treats anything that can't be an id as not found", () => {
    for (const bad of ['abc', '-1', '0', '1.5', '99999999999']) {
      expect(
        statusOf(() => new IdPipe().transform(bad, meta)),
        bad,
      ).toBe(404);
    }
  });

  it('refuses a missing id unless it is optional', () => {
    expect(statusOf(() => new IdPipe().transform(undefined, meta))).toBe(400);
    expect(new IdPipe(true).transform(undefined, meta)).toBeUndefined();
  });
});
