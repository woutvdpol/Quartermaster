// Newsletter module (decision 14: own sending). Safe to import from Next.js server code:
// nothing here renders mail — rendering happens in the worker (`mail.send` job).
export {
  subscribe,
  confirmSubscription,
  unsubscribeSigned,
  listSubscribers,
  subscriberCounts,
  exportSubscribersCsv,
  deleteSubscribers,
  subscriberStatus,
  CONFIRM_TOKEN_TTL_DAYS,
  type SubscribeResult,
  type ConfirmResult,
  type UnsubscribeResult,
  type SubscriberListQuery,
  type SubscriberRow,
  type SubscriberStatus,
} from "./subscribers";
export {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  campaignBodyHtml,
  getNewsletterQuota,
  sendTestCampaign,
  sendCampaign,
  type CampaignInput,
  type CampaignRow,
  type SendCampaignResult,
} from "./campaigns";
export { signUnsubscribe, verifyUnsubscribe } from "./signing";
export { checkQuota, monthWindow } from "./quota";
export { CAMPAIGN_BATCH_SIZE } from "./jobs";
