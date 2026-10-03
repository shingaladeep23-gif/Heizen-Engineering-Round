import { NotFoundException, PipeTransform } from '@nestjs/common';

// The biggest id Postgres can store (INT4).
export const MAX_ID = 2_147_483_647;

/**
 * An id from the URL or query string. Anything that can't be an id ("abc",
 * -1, or a number too big for the database) simply isn't found, rather than
 * a technical message or a database crash. Optional when the value is left out.
 */
export class IdPipe implements PipeTransform<string | undefined, number | undefined> {
  transform(value: string | undefined) {
    if (value === undefined) return undefined;
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1 || id > MAX_ID) {
      throw new NotFoundException({ message: 'Not found' });
    }
    return id;
  }
}
