import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  CappedLimit,
  DaysProperty,
  LimitQuery,
  SearchProperty,
} from '../../../common/dto/paging.dto';

/** An optional uuid filter arriving as a query string. `''` means "unset", not "match nothing". */
export function OptionalIdFilter() {
  return (target: object, key: string) => {
    ApiPropertyOptional({ format: 'uuid' })(target, key);
    IsOptional()(target, key);
    // Rejected here rather than reaching the driver: a malformed uuid used to surface as a 22P02
    // that PrismaExceptionFilter had to translate back into the 400 it always was.
    IsUUID()(target, key);
    Transform(({ value }) => (value === '' ? undefined : value))(target, key);
  };
}

export class OrgsQuery extends LimitQuery {
  /** matched against name and email, case-insensitively */
  @SearchProperty()
  q?: string;
}

export class ScansQuery extends LimitQuery {
  @OptionalIdFilter()
  campaign_id?: string;
}

export class WithdrawalsQuery extends LimitQuery {
  @ApiPropertyOptional({ enum: ['requested', 'paid', 'rejected'] })
  @IsOptional()
  @IsIn(['requested', 'paid', 'rejected'])
  @Transform(({ value }) => (value === '' ? undefined : value))
  status?: string;
}

export class AnalyticsQuery {
  @OptionalIdFilter()
  campaign_id?: string;

  @DaysProperty()
  days!: number;
}

export class LedgerQuery {
  /** an opaque account string such as `campaign:{id}` or `platform:fees` — not a foreign key */
  @SearchProperty(120)
  account?: string;

  // 300 rather than the usual 200: this is the reconciliation view, and it was always read deeper.
  @CappedLimit(300)
  limit!: number;
}
