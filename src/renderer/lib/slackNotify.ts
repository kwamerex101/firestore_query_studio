/**
 * Optional Slack-webhook notifications for slow queries.
 *
 * Webhook URL + threshold live in `localStorage` (same storage tier as the
 * theme preference — users control them from Settings). POSTs run through
 * the browser's `fetch` with `mode: 'no-cors'` so Slack's permissive
 * webhook endpoint accepts the request from any origin.
 */

const WEBHOOK_KEY = 'fqs-slack-webhook';
const THRESHOLD_KEY = 'fqs-slack-threshold-ms';
const DEFAULT_THRESHOLD_MS = 10_000;

export interface SlackSettings {
  webhookUrl: string;
  thresholdMs: number;
}

export function getSlackSettings(): SlackSettings {
  try {
    return {
      webhookUrl: localStorage.getItem(WEBHOOK_KEY) ?? '',
      thresholdMs:
        Number(localStorage.getItem(THRESHOLD_KEY)) || DEFAULT_THRESHOLD_MS,
    };
  } catch {
    return { webhookUrl: '', thresholdMs: DEFAULT_THRESHOLD_MS };
  }
}

export function setSlackSettings(next: SlackSettings): void {
  try {
    if (next.webhookUrl) localStorage.setItem(WEBHOOK_KEY, next.webhookUrl);
    else localStorage.removeItem(WEBHOOK_KEY);
    localStorage.setItem(THRESHOLD_KEY, String(next.thresholdMs));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export interface SlackNotifyParams {
  question: string;
  /** Firestore collection or SQL table/dialect label. */
  target: string;
  rowCount: number;
  durationMs: number;
  ok: boolean;
  profileName?: string;
}

/**
 * Fire-and-forget notification. Returns true when the POST was attempted,
 * false when the webhook/threshold gate short-circuited. Errors are
 * swallowed — a failing webhook should never block the query UI.
 */
export async function maybeNotifySlowQuery(
  params: SlackNotifyParams,
): Promise<boolean> {
  const { webhookUrl, thresholdMs } = getSlackSettings();
  if (!webhookUrl) return false;
  if (params.durationMs < thresholdMs) return false;

  const seconds = (params.durationMs / 1_000).toFixed(1);
  const emoji = params.ok ? ':white_check_mark:' : ':x:';
  const text = [
    `${emoji} *Firestore Query Studio* — query finished in ${seconds}s`,
    params.profileName ? `> *Profile:* ${params.profileName}` : null,
    `> *Target:* \`${params.target}\``,
    `> *Rows:* ${params.rowCount}`,
    `> *Question:* ${params.question}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return true;
  } catch {
    // Webhook posting is best-effort — a network failure is expected on
    // offline devices and should not disrupt the query flow.
    return false;
  }
}
