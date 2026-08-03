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
 * Every route here takes an id straight from the URL and hands it to Prisma, and every id
 * column is `@db.Uuid`. A request for `/v1/qr-codes/not-a-uuid/image` therefore reaches
 * Postgres as an invalid uuid literal, Prisma raises, and Nest's default handler turns that
 * into a 500 — for what is plainly a malformed request.
 *
 * Fixing it per-route would mean a `ParseUUIDPipe` on ~20 params and a `::uuid` guard on
 * every raw query, and the next route added would miss it. Translating the driver's own
 * error codes once, here, covers all of them including the ones that do not exist yet.
 *
 * Only the codes with an unambiguous HTTP meaning are mapped. Anything else stays a 500,
 * because a database error nobody anticipated is a real fault and should page someone.
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
    // Value rejected before/at the driver — an unparseable uuid is the common case.
    case 'P2007':
    case 'P2006':
      return new BadRequestException('malformed identifier or field value');
    // Raw query failed. Only `22P02` (invalid_text_representation, i.e. a bad `::uuid`
    // cast) is a client mistake; any other raw failure is ours and stays a 500.
    case 'P2010':
      return /22P02/.test(String(e.message)) ? new BadRequestException('malformed identifier') : null;
    case 'P2002':
      return new ConflictException('already exists');
    case 'P2003':
      return new BadRequestException('referenced record does not exist');
    case 'P2025':
      return new NotFoundException();
    default:
      return null;
  }
}
