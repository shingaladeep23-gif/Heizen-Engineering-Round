import { BadRequestException } from '@nestjs/common';
import { employeeSchema } from '@fernleaf/shared';
import { describe, expect, it } from 'vitest';
import { ZodPipe } from './zod.pipe.js';

const errorFrom = (value: unknown) => {
  try {
    new ZodPipe(employeeSchema).transform(value);
  } catch (error) {
    return (error as BadRequestException).getResponse() as {
      message: string;
      fieldErrors: Record<string, string>;
    };
  }
  throw new Error('expected the pipe to refuse this');
};

describe('ZodPipe', () => {
  it('names the one problem, on its field', () => {
    const body = errorFrom({ companyId: 1, name: 'Asha', email: 'not-an-email' });
    expect(body.message).toBe('Enter a valid email');
    expect(body.fieldErrors).toEqual({ email: 'Enter a valid email' });
  });

  it('points at the fields when there are several, in plain words', () => {
    const body = errorFrom({ companyId: 1, name: '', email: 'a@b.in', allergyIds: [1.5] });
    expect(body.message).toBe('Please fix the highlighted fields');
    expect(body.fieldErrors).toEqual({
      name: 'Required',
      'allergyIds.0': 'Must be a whole number',
    });
  });
});
