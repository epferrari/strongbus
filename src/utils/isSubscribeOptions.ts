import { SubscribeOptions } from "../types/surfaces/subscriptionSurface";

/**
 * @ignore
 */
export function isSubscribeOptions(value: unknown): value is SubscribeOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}