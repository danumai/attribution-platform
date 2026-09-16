/**
 * The two Payments request bodies, shared by controller and service. Plain types, not DTO classes:
 * checkout is `str()`-bounded then re-checked against its campaign; the webhook is trusted by signature.
 */

export type CheckoutBody = {
  campaign_id: string;
  /** whole credits to buy; bounded 1–10,000,000 by the service */
  coins: number;
};

export type WebhookBody = {
  /** the id `checkout` minted and the PSP carried in its metadata */
  payment_id?: string;
  /** the PSP's own charge id — unique across payments, so one charge completes at most one row */
  provider_ref?: string;
  /** `succeeded` | `failed` */
  status?: string;
};
