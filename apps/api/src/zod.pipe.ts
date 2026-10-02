import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

// Validates a request body against a shared zod schema. Errors come back as
// { message, fieldErrors: { field: reason } } so forms can show them in place.
export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      fieldErrors[issue.path.join('.') || '_'] ??= issue.message;
    }
    throw new BadRequestException({
      message: 'Please fix the highlighted fields',
      fieldErrors,
    });
  }
}
