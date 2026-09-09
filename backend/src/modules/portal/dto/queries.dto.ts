import { CappedLimit, DaysProperty } from '../../../common/dto/paging.dto';

/** Where this campaign's scans came from, over a bounded window. */
export class CampaignAnalyticsQuery {
  @DaysProperty()
  days!: number;
}

/** 100 rather than the usual 200: the revenue-reconciliation view, always read a page at a time. */
export class RedemptionsQuery {
  @CappedLimit(100)
  limit!: number;
}
