import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Turns a driver-level error into the 4xx it actually is. Ids come straight from the URL into
 * `@db.Uuid` columns, so `/v1/qr-codes/not-a-uuid/image` would otherwise 500. Only codes with an
 * unambiguous HTTP meaning are mapped.
 */
@Catch()
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    if (!(e instanceof HttpException)) {
      const mapped = translate(e);
      if (mapped) return super.catch(mapped, host);
    }
    super.catch(e, host);
  }
}

function translate(e: any): HttpException | null {
  switch (e?.code) {
    // P2023 ("Inconsistent column data") is the malformed-uuid case this file exists for.
    case 'P2023':
    case 'P2007':
    case 'P2006':
      return new BadRequestException('malformed identifier or field value');
    case 'P2002':
      return new ConflictException('already exists');
    case 'P2003':
      return new BadRequestException('referenced record does not exist');
    case 'P2025':
      return new NotFoundException();
    // Raw/adapter error with no Prisma code. Only `22P02` (bad `::uuid` cast) is a client mistake.
    default:
      return /\b22P02\b/.test(String(e?.message ?? ''))
        ? new BadRequestException('malformed identifier')
        : null;
  }
}
