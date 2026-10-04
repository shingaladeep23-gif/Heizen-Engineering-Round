import {
  BadRequestException,
  NotFoundException,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';

// The biggest id Postgres can store (INT4).
export const MAX_ID = 2_147_483_647;

/**
 * An id from the URL or query string. Anything that can't be an id ("abc",
 * -1, or a number too big for the database) simply isn't found, rather than
 * a technical message or a database crash. Required unless created with
 * `new IdPipe(true)`: a missing required id is a 400 naming it.
 */
export class IdPipe implements PipeTransform<string | undefined, number | undefined> {
  constructor(private readonly optional = false) {}

  transform(value: string | undefined, { data }: ArgumentMetadata) {
    if (value === undefined || value === '') {
      if (this.optional) return undefined;
      throw new BadRequestException({ message: `${data ?? 'id'} is required` });
    }
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1 || id > MAX_ID) {
      throw new NotFoundException({ message: 'Not found' });
    }
    return id;
  }
}
