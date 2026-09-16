import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Bonus } from '../../common/attribution';
import { Rates } from '../../common/rates';
import { scanAnalytics } from '../../common/analytics';
import { audit, balance, balances, ledger, withdrawable } from '../../common/ledger';
import { PrismaService, Tx } from '../../config/prisma';

/**
 * All portal data access, no policy — except transactions (`tx` never leaves this file; the
 * withdrawal ceiling needs `withdrawable`'s FOR UPDATE lock) and `P2002`, which means something
 * different per statement.
 */

/** The resolved four rates plus the two sides and the fee snapshot — see `requestPartnership`. */
export interface PartnershipCreate extends Rates {
  promoter_org_id: string;
  publisher_org_id: string;
  platform_fee_bps: number;
}

/** Always written as a set so the publisher accepts numbers, not a delta. All-`null` = cleared. */
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

/** Only what `PATCH /orgs/me` may write; key presence is what makes a column written. */
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

// Either side of a partnership; campaigns, redemptions and QR codes are reached through it.
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

// Wider than the patch response: also the fields a tenant cannot set.
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

  // Unlocked read: display only. The spending request locks itself — see `createWithdrawal`.
  withdrawableNow(publisherOrgId: string) {
    return withdrawable(this.db, publisherOrgId, false);
  }

  // ------------------------------------------------------------------------------- publishers

  // Suspended and unapproved publishers excluded: neither can ever pay out.
  listPublishers() {
    return this.db.org.findMany({
      where: { type: 'publisher', suspended: false, approved: true },
      select: PUBLISHER_DIRECTORY_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  // ------------------------------------------------------------------------------ partnerships

  // The FK only proves the id names *an org*; without this, campaigns die at the redirect.
  findEligiblePublisher(id: string) {
    return this.db.org.findFirst({
      where: { id, type: 'publisher', suspended: false, approved: true },
      select: { id: true },
    });
  }

  createPartnership(data: PartnershipCreate) {
    return this.db.partnership.create({ data }).catch((e: { code?: string }) => {
      // UNIQUE = one per pair; P2003 = publisher deleted since the eligibility check.
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

  // updateMany puts ownership *and* `status: 'pending'` in the WHERE — otherwise accepting
  // doubles as an undo for an admin suspension.
  async acceptPartnership(id: string, publisherOrgId: string): Promise<number> {
    const { count } = await this.db.partnership.updateMany({
      where: { id, publisher_org_id: publisherOrgId, status: 'pending' },
      data: { status: 'active' },
    });
    return count;
  }

  // `active` only: a suspended partnership is an admin hold, and repricing must not lift it.
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

  // Compare-and-set on the proposal: a revision between read and click would otherwise apply a
  // price nobody is looking at.
  async decideRates(id: string, expected: RateProposal, data: RateDecision): Promise<number> {
    const { count } = await this.db.partnership.updateMany({ where: { id, ...expected }, data });
    return count;
  }

  // --------------------------------------------------------------------------------- campaigns

  // Includes the publisher's offer list: a campaign advertises a subset of it.
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

  // Both sides may read; which side may *act* is decided in the service.
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

  // Credit a campaign budget. A caller-supplied key makes retries collide on
  // `UNIQUE (account, ref)`; the PSP checkout that replaces this keys on the payment intent.
  fundCampaign(campaignId: string, coins: number, key?: string) {
    return this.db
      .$transaction(async (tx: Tx) => {
        const ref = `fund:${campaignId}:${key ?? Date.now()}`;
        await ledger(tx, 'external:funding', -coins, ref);
        await ledger(tx, `campaign:${campaignId}`, coins, ref);
      })
      .catch((e: { code?: string }) => {
        // Same key, same campaign: the first call already landed.
        if (e.code === 'P2002' && key) return;
        throw e;
      });
  }

  // ---------------------------------------------------------------------------------- qr codes

  createQrCode(data: QrCodeCreate) {
    return this.db.qrCode.create({ data });
  }

  // Promoter-scoped in the WHERE: a publisher has no say over artwork it did not print.
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

  // Own query because the join is campaign → partnership → publisher, three tables out.
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

  // The App Clip pair as stored, so the rule can be judged on the post-patch org.
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
        // UNIQUE on `slug`; 409 not 500 — the publisher resolves it by picking another.
        if (e.code === 'P2002') throw new ConflictException('that slug is already taken');
        throw e;
      });
  }

  // ------------------------------------------------------------------------------- withdrawals

  // Ceiling is tested inside the transaction because `withdrawable` locks the balance row, so
  // concurrent requests serialise instead of both spending the same pool.
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
