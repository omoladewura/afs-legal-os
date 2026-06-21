/**
 * AFS Legal OS — Push Subscription Service
 *
 * Phase 9E — Background push infrastructure.
 *
 * Responsibilities:
 *  1. Fetch the VAPID public key from the Worker (/push/vapid-public-key).
 *  2. Create a PushSubscription against that key via pushManager.subscribe().
 *  3. POST the subscription JSON to the Worker (/push/subscribe) so the
 *     Worker can reach this device when the app is closed.
 *  4. Expose helpers consumed by AlertsEngine's notification opt-in flow
 *     and (Phase 9F) the Worker-side alert dispatch.
 *
 * This module only handles the *client-side subscription* half of the
 * pipeline. The Worker-side send logic (Phase 9F) lives in the Cloudflare
 * Worker. Nothing here changes how alerts are shown while the app is open —
 * that path (requestAndNotify in AlertsEngine) remains unchanged.
 *
 * VAPID key fetch is cached in sessionStorage so the Worker isn't hit on
 * every opt-in click; the subscription itself is cached in localStorage so
 * we don't re-subscribe on every app load (the browser deduplicates by
 * applicationServerKey anyway, but avoiding the round-trip is cleaner).
 */

import { AUTH_TOKEN, WORKER_URL } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PushSubscriptionResult {
  status:       'subscribed' | 'already_subscribed' | 'denied' | 'unsupported' | 'error';
  subscription: PushSubscription | null;
  error?:       string;
}

// ── Storage keys ────────────────────────────────────────────────────────────

const VAPID_KEY_CACHE  = 'afs_vapid_public_key';
const SUB_ENDPOINT_KEY = 'afs_push_endpoint';   // track last-sent endpoint to avoid duplicate POSTs

// ── VAPID public key ────────────────────────────────────────────────────────

/**
 * Fetches the VAPID public key from the Worker.
 * Cached in sessionStorage for the tab lifetime — the key never changes
 * between deploys, so a session-scoped cache is sufficient.
 */
async function getVapidPublicKey(): Promise<string> {
  const cached = sessionStorage.getItem(VAPID_KEY_CACHE);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/push/vapid-public-key`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`VAPID key fetch failed: HTTP ${res.status}`);

  const { publicKey } = await res.json() as { publicKey: string };
  if (!publicKey) throw new Error('VAPID key missing from Worker response');

  sessionStorage.setItem(VAPID_KEY_CACHE, publicKey);
  return publicKey;
}

/** Converts a base64url VAPID public key string to a Uint8Array for pushManager.subscribe(). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding  = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw      = atob(base64);
  const output   = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

// ── Subscription POST ────────────────────────────────────────────────────────

/**
 * Sends the PushSubscription to the Worker's /push/subscribe endpoint.
 * The Worker stores it (Cloudflare KV or D1) and uses it when dispatching
 * background alerts via web-push.
 *
 * Skips the POST if we've already sent this exact endpoint — avoids
 * duplicate entries in the Worker store across page loads.
 */
async function sendSubscriptionToWorker(sub: PushSubscription): Promise<void> {
  const endpoint = sub.endpoint;
  const lastSent = localStorage.getItem(SUB_ENDPOINT_KEY);
  if (lastSent === endpoint) return;   // already registered this subscription

  const res = await fetch(`${WORKER_URL}/push/subscribe`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(sub.toJSON()),
  });

  if (!res.ok) {
    // Non-fatal: the local notification permission is still granted.
    // Background delivery won't work until the Worker has the subscription,
    // but in-app notifications are unaffected.
    console.warn(`[AFS Push] /push/subscribe returned HTTP ${res.status}`);
    return;
  }

  // Record the sent endpoint so subsequent loads skip the POST
  try { localStorage.setItem(SUB_ENDPOINT_KEY, endpoint); } catch { /* storage quota */ }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Requests notification permission, creates a PushSubscription, and
 * registers it with the Worker.
 *
 * Called by AlertsEngine when the user taps the 🔔 button on an alert
 * (instead of the bare Notification.requestPermission() call currently there).
 *
 * The caller can check result.status to show appropriate feedback:
 *   'subscribed'          → first-time subscription, Worker notified
 *   'already_subscribed'  → permission was already granted, SW already subscribed
 *   'denied'              → user denied (or previously denied) permission
 *   'unsupported'         → browser/SW doesn't support push
 *   'error'               → unexpected failure (see result.error)
 */
export async function subscribeToPush(): Promise<PushSubscriptionResult> {
  // Feature detection
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { status: 'unsupported', subscription: null };
  }

  // Permission check / request
  if (Notification.permission === 'denied') {
    return { status: 'denied', subscription: null };
  }

  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { status: 'denied', subscription: null };
  }

  try {
    const reg = await navigator.serviceWorker.ready;

    // Check for existing subscription first
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // Make sure the Worker has it (in case the localStorage record was cleared)
      await sendSubscriptionToWorker(existing).catch(() => {});
      return { status: 'already_subscribed', subscription: existing };
    }

    // Create a new subscription
    const vapidKey    = await getVapidPublicKey();
    const appServerKey = urlBase64ToUint8Array(vapidKey);

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,   // required for web push
      applicationServerKey: appServerKey,
    });

    // Register with the Worker (non-blocking — local permission already granted)
    await sendSubscriptionToWorker(sub).catch(() => {});

    return { status: 'subscribed', subscription: sub };

  } catch (err) {
    return {
      status:       'error',
      subscription: null,
      error:        (err as Error).message,
    };
  }
}

/**
 * Unsubscribes from push and clears the cached endpoint.
 * Called if the user explicitly opts out of notifications.
 */
export async function unsubscribeFromPush(): Promise<void> {
  try {
    const reg      = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
    localStorage.removeItem(SUB_ENDPOINT_KEY);
    sessionStorage.removeItem(VAPID_KEY_CACHE);
  } catch { /* best-effort */ }
}

/**
 * Returns true if the browser has an active push subscription.
 * Used to show the correct state on the notification opt-in button.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}
