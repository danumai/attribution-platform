/**
 * The two Partner API request bodies. Plain types, not DTO classes: the service bounds each field
 * with `str()` and checks what it *means* (is this a claim id the scan issued?), not just its type.
 */

export type FirstOpenBody = {
  /** raw string from Play's Install Referrer API — Android */
  install_referrer?: string;
  /** the claim id alone: what the App Clip container or the pasteboard handed the app */
  claim_id?: string;
  /** `referrer` | `appclip` | `pasteboard`. Reporting only; inferred when absent. */
  carrier?: string;
  /** device integrity, as asserted by the SDK */
  emulator?: boolean;
  rooted?: boolean;
  vpn?: boolean;
};

export type ClaimBody = {
  publisher_user_ref: string;
  /** preferred: the id `first-open` returned for this device */
  install_id?: string;
  /** legacy single-call shape: raw string from Play's Install Referrer API */
  install_referrer?: string;
  /** legacy single-call shape: the claim id alone, as the SDK stored it */
  claim_id?: string;
  /** legacy single-call shape: which carrier produced it */
  carrier?: string;
  /** Engagement path: a promoter-minted transaction code. Never read out of `install_referrer`,
   *  since the payouts and terms differ. */
  code?: string;
  /** Publisher asserting the account is brand-new; only `false` acts, so old integrations are safe. */
  is_new_user?: boolean;
  /** the publisher asserting this user cleared its own verification bar */
  identified?: boolean;
};
