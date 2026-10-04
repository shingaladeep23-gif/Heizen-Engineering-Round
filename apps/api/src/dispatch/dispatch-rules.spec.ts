import { deliveredOnTime, stageOf, stepProblem, type Progress } from './dispatch-rules.js';

const T = new Date('2026-10-07T06:00:00Z');
const order = (done: (keyof Progress)[], driverId: number | null = 4): Progress => ({
  kitchenReadyAt: done.includes('kitchenReadyAt') ? T : null,
  dispatchReadyAt: done.includes('dispatchReadyAt') ? T : null,
  outForDeliveryAt: done.includes('outForDeliveryAt') ? T : null,
  deliveredAt: done.includes('deliveredAt') ? T : null,
  driverId,
});
const COOKED = order(['kitchenReadyAt']);
const READY = order(['kitchenReadyAt', 'dispatchReadyAt']);
const OUT = order(['kitchenReadyAt', 'dispatchReadyAt', 'outForDeliveryAt']);

describe('stageOf', () => {
  it('is as far along as the slowest order', () => {
    expect(stageOf([READY, COOKED])).toBe('kitchen-ready');
    expect(stageOf([READY, order([])])).toBe('cooking');
    expect(stageOf([OUT, OUT])).toBe('out');
  });
});

describe('stepProblem', () => {
  it('needs every order cooked before it can be dispatch ready', () => {
    expect(stepProblem([COOKED, order([])], 'dispatch-ready')).toBe(
      "1 of 2 orders aren't cooked yet",
    );
    expect(stepProblem([COOKED, COOKED], 'dispatch-ready')).toBeNull();
  });

  it("can't skip a step", () => {
    expect(stepProblem([COOKED], 'out')).toMatch(/aren't ready for dispatch/);
    expect(stepProblem([READY], 'delivered')).toMatch(/aren't out for delivery/);
  });

  it("can't repeat a step", () => {
    expect(stepProblem([READY], 'dispatch-ready')).toMatch(/already done/);
  });

  it('needs a driver to go out for delivery', () => {
    const noDriver = { ...READY, driverId: null };
    expect(stepProblem([noDriver], 'out')).toBe('Assign a driver first');
    expect(stepProblem([READY], 'out')).toBeNull();
  });

  it('needs one driver for the whole drop', () => {
    const other = { ...READY, driverId: (READY.driverId ?? 0) + 1 };
    expect(stepProblem([READY, other], 'out')).toMatch(/different drivers/);
    expect(stepProblem([READY, READY], 'out')).toBeNull();
  });
});

describe('deliveredOnTime', () => {
  const due = new Date('2026-10-07T07:00:00Z');
  it('counts deliveries inside the grace period as on time', () => {
    expect(deliveredOnTime(new Date('2026-10-07T07:10:00Z'), due, 10)).toBe(true);
    expect(deliveredOnTime(new Date('2026-10-07T07:10:01Z'), due, 10)).toBe(false);
  });
});
