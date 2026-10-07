/** Storefront page with a "Confirm" button (POST) — GET never verifies (mail scanners follow links). */
export const VERIFY_EMAIL_PATH = "/account/verify-email";

/**
 * Verification links stay valid for 24 hours. NOTE: docs/02-besluiten.md proposes 30 minutes for
 * one-time tokens; that fits password resets, but a verification link is low-risk (it grants no
 * access) and people often open it later, so it gets a longer window.
 */
export const EMAIL_VERIFICATION_TTL_HOURS = 24;
