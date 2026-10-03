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
    // One problem: say exactly what it is. Several: point at the fields.
    const messages = Object.values(fieldErrors);
    throw new BadRequestException({
      message: messages.length === 1 ? messages[0] : 'Please fix the highlighted fields',
      fieldErrors,
    });
  }
}
