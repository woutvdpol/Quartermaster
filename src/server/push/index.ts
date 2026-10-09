// Web push alerts (docs/push.md). Safe to import from Next.js server code — sending (web-push) lives
// in ./send.ts and is only loaded by the worker through the `push.send` job.
export { vapidPublicKey, isPushConfigured } from "./config";
export {
  savePushSubscription,
  removePushSubscription,
  getPushPrefs,
  updatePushPrefs,
  pushRecipients,
  queuePush,
  queueSavedSearchPush,
  queuePriceDropPushes,
  type PushOwner,
  type PushPrefs,
  type PushPrefsPatch,
  type QueuePushInput,
} from "./service";
export { QUIET_HOUR_PRESETS, MAX_PER_DAY_OPTIONS, DEFAULT_MAX_PER_DAY, type PushKind } from "./rules";
