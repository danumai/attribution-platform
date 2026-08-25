/**
 * Every creation and repricing on this page, as a dialog.
 *
 * These used to be forms parked permanently under their own lists, on screen whether or not
 * anyone wanted to create anything. A creation form is a moment, not furniture.
 *
 * Plain functions rather than components: each one is `await a dialog, validate, then call the
 * API`, and none of it renders. Taking the data it needs as arguments also keeps the branching
 * money rules in `editCampaign` readable on their own, away from a thousand lines of markup.
 */
import { api } from '@/lib/api';
import { formDialog, toast } from '@/lib/ui';
import { num } from '@/lib/fmt';
import type { Campaign, Me, Partnership, PublisherOption } from '@/lib/types';
import type { Act } from './types';

export async function newPartnership(publishers: PublisherOption[], act: Act) {
  const v = await formDialog({
    title: 'Request a publisher partnership',
    body: 'The rates are fixed here, before any campaign can spend against them.',
    confirmText: 'Request partnership',
    fields: [
      {
        name: 'publisher_org_id',
        label: 'Publisher',
        type: 'select',
        required: true,
        placeholder: 'Select a publisher…',
        options: publishers.map((p) => ({
          value: p.id,
          label: p.name,
        })),
      },
      { name: 'coin_rate', label: 'Coins granted per verified signup (full tier)', type: 'number', value: '50', required: true },
      { name: 'guest_rate', label: 'Coins for an unverified guest (the rest is held back)', type: 'number', value: '10', required: true },
      { name: 'grace_days', label: 'Days a guest has to verify and claim the remainder', type: 'number', value: '7', required: true },
      { name: 'engagement_rate', label: 'Coins per repeat purchase (repeat-purchase campaigns only)', type: 'number', value: '20', required: true },
    ],
  });
  if (!v) return;
  // Worth knowing before a print run, not after: this publisher's scans go nowhere until it
  // registers a destination. Partnering is still fine — printing codes is not.
  if (!publishers.find((p) => p.id === v.publisher_org_id)?.ready)
    toast.info('That publisher has no app or web fallback registered yet, so scans cannot be delivered until it does.');
  await act(
    () =>
      api('/v1/partnerships', {
        method: 'POST',
        body: JSON.stringify({
          publisher_org_id: v.publisher_org_id,
          coin_rate: +v.coin_rate,
          guest_rate: +v.guest_rate,
          grace_days: +v.grace_days,
          engagement_rate: +v.engagement_rate,
        }),
      }),
    'Partnership requested — waiting on the publisher.',
  );
}

/**
 * Ask to be paid. Capped at `withdrawable` rather than `earnings`: fees inside the settlement
 * window are earned but not yet payable, and a request for more than that is refused by the
 * API anyway — better to say so before the publisher types a number.
 */
export async function requestPayout(profile: Me | null, act: Act) {
  const available = profile?.withdrawable ?? 0;
  if (available < 1)
    return toast.info(
      'Nothing has cleared the settlement window yet. Fees become payable once the review period has passed.',
    );

  const v = await formDialog({
    title: 'Request a payout',
    body: `${num(available)} of your ${num(profile?.earnings ?? 0)} earned credits have cleared settlement and can be paid out. An admin reviews the request before any money moves.`,
    confirmText: 'Request payout',
    fields: [
      {
        name: 'coins',
        label: `Credits to withdraw (max ${available})`,
        type: 'number',
        value: String(available),
        required: true,
      },
    ],
  });
  if (!v) return;
  await act(
    () => api('/v1/withdrawals', { method: 'POST', body: JSON.stringify({ coins: +v.coins }) }),
    'Payout requested — an admin will review it.',
  );
}

/**
 * Repricing, from the table where the rates actually live. Both tiers here, unlike the
 * campaign dialog: this is the agreement itself, not one campaign spending against it.
 */
export async function proposeRates(p: Partnership, act: Act) {
  const v = await formDialog({
    title: `Propose new rates to ${p.publisher_name}`,
    body: `They are paid ${num(p.guest_rate)} for a guest and ${num(p.coin_rate)} for a verified signup today. Those stay in force until they accept.`,
    confirmText: 'Send for approval',
    fields: [
      {
        name: 'coin_rate',
        label: 'Coins per verified signup (full tier)',
        type: 'number',
        value: String(p.proposed_coin_rate ?? p.coin_rate),
        required: true,
      },
      {
        name: 'guest_rate',
        label: 'Coins for an unverified guest',
        type: 'number',
        value: String(p.proposed_guest_rate ?? p.guest_rate),
        required: true,
        hint: 'Cannot exceed the full tier.',
      },
      {
        name: 'engagement_rate',
        label: 'Coins per repeat purchase',
        type: 'number',
        value: String(p.proposed_engagement_rate ?? p.engagement_rate),
        required: true,
        hint: 'Priced on its own — a returning customer is not an acquisition.',
      },
    ],
  });
  if (!v) return;
  await act(
    () =>
      api(`/v1/partnerships/${p.id}/rates`, {
        method: 'PATCH',
        body: JSON.stringify({
          coin_rate: +v.coin_rate,
          guest_rate: +v.guest_rate,
          engagement_rate: +v.engagement_rate,
        }),
      }),
    `Sent to ${p.publisher_name} — the rates in force do not change until they accept.`,
  );
}

export async function newCampaign(activePartnerships: Partnership[], act: Act) {
  const v = await formDialog({
    title: 'New campaign',
    body: 'A campaign spends against one active partnership, at that partnership’s rates.',
    confirmText: 'Create campaign',
    fields: [
      {
        name: 'partnership_id',
        label: 'Partnership',
        type: 'select',
        required: true,
        placeholder: 'Select…',
        options: activePartnerships.map((p) => ({
          value: p.id,
          label: `${p.publisher_name} — ${p.coin_rate} coins/signup`,
        })),
      },
      { name: 'name', label: 'Campaign name', required: true, placeholder: 'Inflight entertainment promo' },
      {
        name: 'mode',
        label: 'What this campaign pays for',
        type: 'select',
        required: true,
        value: 'acquisition',
        options: [
          { value: 'acquisition', label: 'New signups — one payout per person, ever' },
          { value: 'engagement', label: 'Repeat purchases — one payout per transaction code you issue' },
        ],
      },
      {
        name: 'budget',
        label: 'Starting budget (coins)',
        type: 'number',
        required: true,
        value: '0',
        hint: 'A campaign with no budget refuses every scan — the scanner is told the offer is claimed. Fund it here or in Edit before printing.',
      },
    ],
  });
  if (!v) return;

  const coins = Math.round(+v.budget);
  if (!Number.isFinite(coins) || coins < 0) return toast.error('Budget must be a positive number of coins.');

  await act(async () => {
    const c = (await api('/v1/campaigns', {
      method: 'POST',
      body: JSON.stringify({ partnership_id: v.partnership_id, name: v.name, mode: v.mode }),
    })) as { id: string };
    if (!coins)
      return toast.info(`Campaign "${v.name}" created — every scan is refused until you fund it.`);
    // The campaign already exists by now, so a refused top-up must not read as "creation
    // failed": deployments with self-funding off fund through checkout or an admin adjustment,
    // and the promoter has to be told which of the two happened. Reported here rather than
    // through `act`'s success line for the same reason — that line cannot know.
    try {
      await api(`/v1/campaigns/${c.id}/fund`, {
        method: 'POST',
        body: JSON.stringify({ coins, idempotency_key: `new:${c.id}` }),
      });
      toast.success(`Campaign "${v.name}" created and funded with ${num(coins)} coins.`);
    } catch {
      toast.error(
        `"${v.name}" was created but could not be funded here — fund it through checkout, or ask an admin to adjust its budget. Scans are refused until it holds coins.`,
      );
    }
  });
}

/**
 * Everything a promoter owns on a running campaign, in one dialog.
 *
 * Three different kinds of change, which is why it fans out into three calls rather than one:
 * the name and the status are the campaign's own and land immediately; the budget is money and
 * goes through funding; the rate is the *publisher's* price and can only be proposed.
 *
 * `ended` is a status option and not a button of its own because it is the one status a
 * campaign does not come back from — worth the extra click.
 */
export async function editCampaign(c: Campaign, partnerships: Partnership[], act: Act) {
  const p = partnerships.find((x) => x.id === c.partnership_id);
  const v = await formDialog({
    title: `Edit "${c.name}"`,
    confirmText: 'Save changes',
    fields: [
      { name: 'name', label: 'Campaign name', value: c.name, required: true },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        value: c.status,
        hint: 'Paused and ended campaigns stop granting coins. Ending is permanent.',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'paused', label: 'Paused' },
          { value: 'ended', label: 'Ended' },
        ],
      },
      {
        name: 'budget',
        label: 'Budget (coins)',
        type: 'number',
        value: String(c.budget),
        required: true,
        hint: 'Raising it funds the difference. Taking funded coins back out is an admin adjustment.',
      },
      {
        name: 'covers',
        label: '…or how many more signups to cover',
        type: 'number',
        placeholder: String(Math.floor(c.budget / c.coin_rate)),
        hint: `Same money in the unit you buy it in — wins over Budget when filled. At ${num(c.coin_rate)} coins per signup.`,
      },
      {
        name: 'coin_rate',
        label: 'Rate (coins per verified signup)',
        type: 'number',
        value: String(c.coin_rate),
        required: true,
        hint: `${c.publisher_name} is paid this, so it is a request, not a change — and it applies to every campaign you run with them.`,
      },
    ],
  });
  if (!v) return;

  // The rate the top-up is priced at is the one in force, not the one being proposed: an
  // unaccepted proposal pays nobody, so budgeting at it would fund the wrong number.
  const target = v.covers?.trim() ? Math.ceil(+v.covers * c.coin_rate) : Math.round(+v.budget);
  const topUp = target - c.budget;
  const rate = Math.round(+v.coin_rate);

  // Checked before anything is sent, so an impossible budget cannot leave the name and the
  // status already saved behind a failure.
  if (!Number.isFinite(target) || target < 0) return toast.error('Budget must be a positive number of coins.');
  if (topUp < 0)
    return toast.error(
      `Lowering a funded budget is a clawback an admin has to make. ${c.name} holds ${num(c.budget)} coins.`,
    );
  if (rate !== c.coin_rate) {
    if (!p) return toast.error('Reload before changing the rate — this campaign’s partnership is not loaded.');
    if (rate < p.guest_rate)
      return toast.error(`The full rate cannot sit below the guest rate of ${num(p.guest_rate)}.`);
  }

  const summary =
    [
      `"${v.name}" saved`,
      v.status === c.status ? '' : `now ${v.status}`,
      topUp > 0 ? `funded ${num(topUp)} coins` : '',
      rate !== c.coin_rate ? `new rate sent to ${c.publisher_name} for approval` : '',
    ]
      .filter(Boolean)
      .join(' — ') + '.';

  await act(async () => {
    await api(`/v1/campaigns/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: v.name, status: v.status }),
    });
    if (topUp > 0)
      await api(`/v1/campaigns/${c.id}/fund`, {
        method: 'POST',
        // Keyed on where the budget was *and* where it is going, so a double-click funds once
        // while a genuine second top-up to the same target — after scans have spent some of
        // it — is a different key and still lands.
        body: JSON.stringify({ coins: topUp, idempotency_key: `edit:${c.budget}:${target}` }),
      });
    if (rate !== c.coin_rate && p)
      await api(`/v1/partnerships/${p.id}/rates`, {
        method: 'PATCH',
        body: JSON.stringify({ coin_rate: rate }),
      });
  }, summary);
}
