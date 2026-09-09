import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Bonus } from '../../common/attribution';
import { Rates } from '../../common/rates';
import { scanAnalytics } from '../../common/analytics';
import { audit, balance, balances, ledger, withdrawable } from '../../common/ledger';
import { PrismaService, Tx } from '../../config/prisma';

/**
 * Every read and write the tenant portal performs, and nothing else — no shaping, no policy.
 *
 * Three things live here that look like business rules and are not misplaced:
 *
 *  - the two transactional units (`fundCampaign`, `createWithdrawal`). A transaction is a
 *    data-access boundary, so the service never handles a `tx`. The withdrawal ceiling has to be
 *    tested under the `FOR UPDATE` lock `withdrawable` takes or it is not serialised at all, so
 *    that method throws the domain exception itself.
 *  - the Prisma error codes. `P2002` on a partnership means "already exists", on a slug means
 *    "taken", and inside a keyed funding means "this retry already landed" — three different
 *    answers to one driver code, and the mapping needs to know which statement raised it.
 *  - `audit`, `balance(s)`, `withdrawable` and `scanAnalytics`, which are already data access
 *    shared with the other modules. Wrapped rather than duplicated.
 */

/** The resolved four rates plus the two sides and the fee snapshot — see `requestPartnership`. */
export interface PartnershipCreate extends Rates {
  promoter_org_id: string;
  publisher_org_id: string;
  platform_fee_bps: number;
}

/**
 * The three proposal columns, always written as a set: a publisher accepting must see every
 * number it is agreeing to, not a delta. `null` across the set is a cleared proposal.
 */
export interface RateProposal {
  proposed_coin_rate: number | null;
  proposed_guest_rate: number | null;
  proposed_engagement_rate: number | null;
}

/** An accepted proposal writes the agreed rates and clears itself in the same statement. */
export interface RateDecision extends RateProposal {
  coin_rate?: number;
  guest_rate?: number;
  engagement_rate?: number;
}

export interface CampaignPatch {
  name?: string;
  status?: string;
  bonus_types?: string[];
}

export interface QrCodeCreate {
  campaign_id: string;
  code: string;
  style: object;
  expires_at: Date | null;
  max_uses: number | null;
}

/** Only the columns `PATCH /orgs/me` may write; presence of a key is what makes it written. */
export interface OrgPatch {
  landing_url?: string | null;
  deeplink_url?: string | null;
  android_package?: string | null;
  ios_app_id?: string | null;
  ios_appclip_id?: string | null;
  slug?: string | null;
  ios_provider_token?: string | null;
  bonuses?: Bonus[];
}

/** Either side of a partnership. Campaigns, redemptions and QR codes are all reached through it. */
const bothSides = (orgId: string) => ({
  OR: [{ promoter_org_id: orgId }, { publisher_org_id: orgId }],
});

const PUBLISHER_DIRECTORY_SELECT = {
  id: true,
  name: true,
  bonuses: true,
  landing_url: true,
  android_package: true,
  ios_app_id: true,
} as const;

/** What a tenant sees of its own org. Wider than the patch response: the fields it cannot set. */
const ORG_ME_SELECT = {
  id: true,
  name: true,
  type: true,
  email: true,
  landing_url: true,
  android_package: true,
  ios_app_id: true,
  ios_appclip_id: true,
  ios_provider_token: true,
  slug: true,
  deeplink_url: true,
  bonuses: true,
  suspended: true,
  approved: true,
} as const;

const ORG_PATCHED_SELECT = {
  id: true,
  name: true,
  type: true,
  landing_url: true,
  android_package: true,
  ios_app_id: true,
  ios_appclip_id: true,
  ios_provider_token: true,
  slug: true,
  deeplink_url: true,
  bonuses: true,
} as const;

@Injectable()
export class PortalRepository {
  constructor(private readonly db: PrismaService) {}

  // ---------------------------------------------------------------- shared money/audit access

  audit(actorOrgId: string | null, action: string, target: string, detail?: unknown) {
    return audit(actorOrgId, action, target, detail);
  }

  balance(account: string) {
    return balance(account);
  }

  balances(accounts: string[]) {
    return balances(accounts);
  }

  scanAnalytics(campaignId: string, days: number) {
    return scanAnalytics(campaignId, days);
  }

  /**
   * Read without the lock and without a transaction: this is a figure on a page, and the request
   * that spends against it takes the lock itself — see `createWithdrawal`.
   */
  withdrawableNow(publisherOrgId: string) {
    return withdrawable(this.db, publisherOrgId, false);
  }

  // ------------------------------------------------------------------------------- publishers

  /** Suspended and unapproved publishers are excluded: neither can ever pay out. */
  listPublishers() {
    return this.db.org.findMany({
      where: { type: 'publisher', suspended: false, approved: true },
      select: PUBLISHER_DIRECTORY_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  // ------------------------------------------------------------------------------ partnerships

  /**
   * The foreign key only proves an id names *an org*. Without this a promoter could partner with
   * one that can never pay out, and every campaign on it dies at the redirect.
   */
  findEligiblePublisher(id: string) {
    return this.db.org.findFirst({
      where: { id, type: 'publisher', suspended: false, approved: true },
      select: { id: true },
    });
  }

  createPartnership(data: PartnershipCreate) {
    return this.db.partnership.create({ data }).catch((e: { code?: string }) => {
      // One partnership per pair, by UNIQUE — and a publisher deleted between the eligibility
      // check and this insert takes the foreign key with it.
      if (e.code === 'P2002') throw new BadRequestException('partnership already exists');
      if (e.code === 'P2003') throw new BadRequestException('publisher not found');
      throw e;
    });
  }

  listPartnerships(orgId: string, take: number) {
    return this.db.partnership.findMany({
      where: bothSides(orgId),
      include: {
        promoter: { select: { name: true } },
        publisher: { select: { name: true, bonuses: true } },
      },
      orderBy: { created_at: 'desc' },
      take,
    });
  }

  findPartnership(id: string) {
    return this.db.partnership.findUnique({ where: { id } });
  }

  /**
   * updateMany so the ownership check is in the WHERE, and `status: 'pending'` with it: with only
   * two states this endpoint *was* the undo for an admin suspension.
   */
  async acceptPartnership(id: string, publisherOrgId: string): Promise<number> {
    const { count } = await this.db.partnership.updateMany({
      where: { id, publisher_org_id: publisherOrgId, status: 'pending' },
      data: { status: 'active' },
    });
    return count;
  }

  /** `active` only — a suspended partnership is an admin hold, and repricing must not lift it. */
  findActivePartnershipAsPromoter(id: string, promoterOrgId: string) {
    return this.db.partnership.findFirst({
      where: { id, promoter_org_id: promoterOrgId, status: 'active' },
    });
  }

  findOpenProposal(id: string, publisherOrgId: string) {
    return this.db.partnership.findFirst({
      where: { id, publisher_org_id: publisherOrgId, proposed_coin_rate: { not: null } },
    });
  }

  updateProposal(id: string, data: RateProposal) {
    return this.db.partnership.update({ where: { id }, data });
  }

  /**
   * Compare-and-set on the proposal itself: a revision between this publisher's read and its
   * click would otherwise apply a price nobody is looking at.
   */
  async decideRates(id: string, expected: RateProposal, data: RateDecision): Promise<number> {
    const { count } = await this.db.partnership.updateMany({ where: { id, ...expected }, data });
    return count;
  }

  // --------------------------------------------------------------------------------- campaigns

  /** The publisher's own offer list comes with it: a campaign advertises a subset of that. */
  findActivePartnershipForCampaign(id: string, promoterOrgId: string) {
    return this.db.partnership.findFirst({
      where: { id, promoter_org_id: promoterOrgId, status: 'active' },
      select: { id: true, publisher: { select: { bonuses: true } } },
    });
  }

  createCampaign(data: {
    partnership_id: string;
    name: string;
    mode: string;
    bonus_types: string[];
  }) {
    return this.db.campaign.create({ data });
  }

  listCampaigns(orgId: string, take: number) {
    return this.db.campaign.findMany({
      take,
      where: { partnership: bothSides(orgId) },
      include: {
        partnership: {
          select: {
            coin_rate: true,
            engagement_rate: true,
            promoter: { select: { name: true } },
            publisher: { select: { name: true, bonuses: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /** Scoped to both sides; which of the two the session is decides what it may *do* — see the service. */
  findOwnedCampaign(orgId: string, campaignId: string) {
    return this.db.campaign.findFirst({
      where: { id: campaignId, partnership: bothSides(orgId) },
      include: {
        partnership: {
          select: {
            promoter_org_id: true,
            publisher_org_id: true,
            coin_rate: true,
            publisher: { select: { bonuses: true } },
          },
        },
      },
    });
  }

  updateCampaign(id: string, data: CampaignPatch) {
    return this.db.campaign.update({ where: { id }, data });
  }

  campaignTotals(campaignId: string) {
    return Promise.all([
      this.db.scan.count({ where: { campaign_id: campaignId } }),
      this.db.redemption.aggregate({
        where: { campaign_id: campaignId },
        _count: true,
        _sum: { coins: true },
      }),
      balance(`campaign:${campaignId}`),
    ]);
  }

  /**
   * Credit a campaign budget. Keyed on the caller's own key when it sends one, so a retry
   * collides on `UNIQUE (account, ref)`. The PSP checkout that replaces this keys on the payment
   * intent, the same shape.
   */
  fundCampaign(campaignId: string, coins: number, key?: string) {
    return this.db
      .$transaction(async (tx: Tx) => {
        const ref = `fund:${campaignId}:${key ?? Date.now()}`;
        await ledger(tx, 'external:funding', -coins, ref);
        await ledger(tx, `campaign:${campaignId}`, coins, ref);
      })
      .catch((e: { code?: string }) => {
        // Same key, same campaign: the first call already landed, and the current budget is the
        // honest reply.
        if (e.code === 'P2002' && key) return;
        throw e;
      });
  }

  // ---------------------------------------------------------------------------------- qr codes

  createQrCode(data: QrCodeCreate) {
    return this.db.qrCode.create({ data });
  }

  /** Promoter-scoped in the WHERE: a publisher has no say over the artwork it did not print. */
  async updateOwnQrCode(
    orgId: string,
    id: string,
    data: { voided?: boolean; style?: object },
  ): Promise<number> {
    const { count } = await this.db.qrCode.updateMany({
      where: { id, campaign: { partnership: { promoter_org_id: orgId } } },
      data,
    });
    return count;
  }

  findQrCode(id: string) {
    return this.db.qrCode.findUnique({ where: { id } });
  }

  listQrCodes(campaignId: string, take: number) {
    return this.db.qrCode.findMany({
      where: { campaign_id: campaignId },
      orderBy: { created_at: 'desc' },
      take,
    });
  }

  /**
   * The publisher's App Clip slug for a campaign, or NULL. Its own query because the join is
   * campaign → partnership → publisher, three tables from the thing being listed.
   */
  async publisherSlug(campaignId: string): Promise<string | null> {
    const c = await this.db.campaign.findUnique({
      where: { id: campaignId },
      select: { partnership: { select: { publisher: { select: { slug: true } } } } },
    });
    return c?.partnership.publisher.slug ?? null;
  }

  // -------------------------------------------------------------------------------------- orgs

  setApiKeyHash(orgId: string, api_key_hash: string) {
    return this.db.org.update({ where: { id: orgId }, data: { api_key_hash } });
  }

  findOrg(orgId: string) {
    return this.db.org.findUniqueOrThrow({ where: { id: orgId }, select: ORG_ME_SELECT });
  }

  /** The App Clip pair as stored, so the rule can be judged on the post-patch org. */
  findClipRegistration(orgId: string) {
    return this.db.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { slug: true, ios_appclip_id: true },
    });
  }

  patchOrg(orgId: string, data: OrgPatch) {
    return this.db.org
      .update({ where: { id: orgId }, data, select: ORG_PATCHED_SELECT })
      .catch((e: { code?: string }) => {
        // UNIQUE on `slug`. A 409 rather than a 500: a name someone else took is the publisher's
        // to resolve by picking another.
        if (e.code === 'P2002') throw new ConflictException('that slug is already taken');
        throw e;
      });
  }

  // ------------------------------------------------------------------------------- withdrawals

  /**
   * Queue a payout request. The ceiling is tested inside the transaction because `withdrawable`
   * locks the balance row: two concurrent requests serialise here, and the second is judged
   * against a pool the first has already claimed from.
   */
  createWithdrawal(publisherOrgId: string, coins: number) {
    return this.db.$transaction(async (tx: Tx) => {
      const available = await withdrawable(tx, publisherOrgId);
      if (coins > available)
        throw new BadRequestException(
          `only ${available} coins are withdrawable — the rest is still inside the settlement window`,
        );
      return tx.withdrawal.create({ data: { publisher_org_id: publisherOrgId, coins } });
    });
  }

  listWithdrawals(publisherOrgId: string, take: number) {
    return this.db.withdrawal.findMany({
      where: { publisher_org_id: publisherOrgId },
      orderBy: { requested_at: 'desc' },
      take,
    });
  }

  // ------------------------------------------------------------------------------- redemptions

  listRedemptions(orgId: string, take: number) {
    return this.db.redemption.findMany({
      where: { campaign: { partnership: bothSides(orgId) } },
      include: {
        campaign: {
          select: { name: true, partnership: { select: { platform_fee_bps: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take,
    });
  }
}
