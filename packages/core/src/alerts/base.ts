import type { AlertChannel, AlertPayload } from '../types/alerts.js';

/**
 * Channel-specific outbound dispatcher. Each concrete sender (M28+)
 * narrows on `channel.type` to read its own typed config.
 *
 * Senders MUST resolve. To surface a delivery failure, throw — the
 * router catches it and records a `failed` delivery with the error
 * message. Returning normally records a `delivered` delivery.
 */
export interface AlertSender {
  send(channel: AlertChannel, payload: AlertPayload): Promise<void>;
}
