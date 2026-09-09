/**
 * Operational alerts: the findings that must reach a human, pushed instead of waiting to be
 * noticed on a dashboard. The observability layer already records everything, but a number on a
 * page nobody has open is not an alert. Structured `error` log always, plus a Slack-compatible
 * `{ text }` POST when ALERT_WEBHOOK_URL is set.
 */
import { ALERT_WEBHOOK_URL } from '../config';
import { count, log } from './obs';
import { prisma } from '../config/prisma';

export async function alert(event: string, fields: Record<string, unknown> = {}) {
  log.error(event, fields);
  count('alerts_total', { event });
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[qrreward] ${event} ${JSON.stringify(fields)}` }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e: any) {
    // The alert channel failing must never take the money path with it.
    log.warn('alert.webhook_failed', { event, error: e?.message });
  }
}

/**
 * The reconciliation the admin overview runs on page load, run on a clock instead — drift between
 * a cached balance and its ledger entries means something is spending against a wrong number.
 *
 * ponytail: aggregates the whole ledger every sweep. Move to an incremental check keyed on recent
 * refs when a sweep is ever slow enough to notice.
 */
export function startReconciliation(intervalMs = 10 * 60_000) {
  const sweep = async () => {
    try {
      const [r] = await prisma.$queryRaw<{ ledger_sum: number; drifted: number }[]>`
        SELECT
          (SELECT coalesce(sum(amount),0)::int FROM ledger_entries) AS ledger_sum,
          (SELECT count(*)::int FROM account_balances b
             LEFT JOIN (SELECT account, sum(amount)::int AS s FROM ledger_entries GROUP BY account) e
               ON e.account = b.account
            WHERE b.balance <> coalesce(e.s, 0)) AS drifted`;
      if (r.ledger_sum !== 0)
        await alert('ledger.unbalanced', { ledger_sum: r.ledger_sum });
      if (r.drifted > 0)
        await alert('ledger.balance_drift', { drifted_accounts: r.drifted });
    } catch (e: any) {
      log.warn('reconciliation.failed', { error: e?.message });
    }
  };
  setInterval(sweep, intervalMs).unref();
  void sweep(); // once at boot — a deploy is exactly when drift is worth catching
}

/**
 * A campaign budget crossing "about to run dry": the promoter's print run is live and every
 * scan after zero dies at /campaign-ended. Alerted once per campaign per process, because a
 * draining budget crosses the threshold on every payout after the first.
 * ponytail: process-lifetime dedupe set; a restart may re-alert once. Harmless.
 */
const lowBudgetAlerted = new Set<string>();

export function budgetLow(campaignId: string, remaining: number, fee: number) {
  if (lowBudgetAlerted.has(campaignId)) return;
  lowBudgetAlerted.add(campaignId);
  void alert('campaign.budget_low', {
    campaign_id: campaignId,
    remaining,
    covers_payouts: fee > 0 ? Math.floor(remaining / fee) : 0,
  });
}
