/**
 * The two Payments request bodies. Plain object types rather than validated DTO classes, matching
 * what these two callers are: the checkout body is bounded by `str()` and then re-checked against
 * the campaign it names, and the webhook body arrives from a PSP whose signature — not its shape —
 * is what makes it trustworthy. Declared here so the controller and the service can share them
 * without importing each other.
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
