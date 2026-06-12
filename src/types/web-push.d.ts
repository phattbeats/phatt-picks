/**
 * Minimal ambient types for the `web-push` surface we use. The package ships no
 * types and we avoid pulling @types/web-push (dev-dep install friction in this
 * container — see project memory). Keep in sync with usage in src/lib/notify.ts.
 */
declare module "web-push" {
  export interface PushSubscriptionShape {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }
  export class WebPushError extends Error {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    endpoint: string;
  }
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: PushSubscriptionShape,
    payload?: string | Buffer | null,
    options?: Record<string, unknown>,
  ): Promise<SendResult>;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
