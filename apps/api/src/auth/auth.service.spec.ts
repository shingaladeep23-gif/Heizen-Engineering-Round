import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import { AuthService } from './auth.service.js';

// No such user, so every attempt fails.
const db = { user: { findUnique: async () => null } } as unknown as PrismaService;
const statusOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: { getStatus(): number }) => error.getStatus(),
  );

describe('sign-in limit', () => {
  it('refuses an email and address after 10 failures in 15 minutes, then lets it try again', async () => {
    const auth = new AuthService(db);
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(await statusOf(auth.check('a@test.com', 'x', '1.2.3.4', t))).toBe(401);
    }
    expect(await statusOf(auth.check('a@test.com', 'x', '1.2.3.4', t))).toBe(429);
    expect(await statusOf(auth.check('A@test.com', 'x', '1.2.3.4', t))).toBe(429);
    // Another address, or the same one 15 minutes later, can try again.
    expect(await statusOf(auth.check('a@test.com', 'x', '5.6.7.8', t))).toBe(401);
    expect(await statusOf(auth.check('a@test.com', 'x', '1.2.3.4', t + 15 * 60_000))).toBe(401);
  });
});
