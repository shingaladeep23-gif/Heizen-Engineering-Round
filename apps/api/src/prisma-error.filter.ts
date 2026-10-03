import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Database errors become the same { message, fieldErrors } shape as every
// other error, instead of a bare 500.
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class PrismaErrorFilter implements ExceptionFilter {
  catch(
    error: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientUnknownRequestError,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<Response>();
    // A number bigger than the database's whole-number columns hold. Forms
    // have their own, friendlier limits; this is the safety net for the rest.
    if (error.message.includes('Unable to fit integer value')) {
      res.status(400).json({ message: 'A number in that request is too large' });
      return;
    }
    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      new Logger('Database').error(error.message);
      res.status(500).json({ message: 'Something went wrong, please try again' });
      return;
    }
    const fields = (error.meta?.target as string[] | undefined) ?? [];

    if (error.code === 'P2002') {
      res.status(409).json({
        message: `That ${fields.join(', ') || 'value'} is already taken`,
        fieldErrors: Object.fromEntries(fields.map((f) => [f, 'Already taken'])),
      });
    } else if (error.code === 'P2003') {
      res.status(409).json({ message: "It's still used elsewhere, so it can't be removed" });
    } else if (error.code === 'P2025') {
      res.status(404).json({ message: 'Not found' });
    } else {
      // Anything unexpected is logged with its Prisma code, so a 500 is never a mystery.
      new Logger('Database').error(`${error.code}: ${error.message}`);
      res.status(500).json({ message: 'Something went wrong, please try again' });
    }
  }
}
