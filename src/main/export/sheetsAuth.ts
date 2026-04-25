import { shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { OAuth2Client, type Credentials } from 'google-auth-library';

/**
 * OAuth 2.0 installed-app flow for Google Sheets.
 *
 * The user creates their own OAuth Desktop client in Google Cloud Console
 * and pastes the client ID + secret into Settings → Google Sheets. Shipping
 * credentials in an open-source repo is a footgun, and Google's OAuth
 * policy explicitly treats desktop clients as public (no secret
 * confidentiality guarantee) so the secret isn't sensitive, but asking
 * the user to supply their own keeps the trust boundary clean.
 *
 * The redirect flow:
 *  1. Open a localhost HTTP server on a free port.
 *  2. Open the consent URL in the user's default browser with
 *     redirect_uri pointing at the localhost server + a CSRF nonce.
 *  3. Google redirects back to `http://127.0.0.1:<port>/callback?code=...`.
 *  4. The local server captures the code, exchanges it for tokens via the
 *     OAuth2Client, and closes.
 *
 * Tokens (refresh + access) are returned to the caller which persists
 * them to safeStorage via `secrets.ts`.
 */

export interface SheetsOAuthInput {
  clientId: string;
  clientSecret: string;
}

export interface SheetsTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string | null;
  tokenType: string | null;
}

const REDIRECT_HOST = '127.0.0.1';
const REDIRECT_PATH = '/callback';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function randomNonce(): string {
  const buf = new Uint8Array(16);
  // `crypto.getRandomValues` is available in Node 20+; fall back to a
  // sync-Math path under test environments that lack it.
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?(v: Uint8Array): void } }).crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function listenEphemeral(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, REDIRECT_HOST, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Failed to bind loopback OAuth server'));
    });
  });
}

function htmlResponse(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><style>
    body{background:#0b0f19;color:#e5eaf5;font:14px/1.5 system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .card{max-width:420px;padding:28px 32px;border:1px solid #1f2937;border-radius:12px;background:#111827}
    h1{font-size:16px;margin:0 0 8px}
    p{margin:6px 0;color:#94a3b8}
  </style><div class="card"><h1>${title}</h1>${body}</div>`;
}

/**
 * Runs the full OAuth consent flow and returns the issued tokens. The
 * caller is responsible for persisting them. Times out after 5 minutes if
 * the user never completes the consent screen.
 */
export async function runSheetsOAuth(
  input: SheetsOAuthInput,
): Promise<SheetsTokens> {
  if (!input.clientId || !input.clientSecret) {
    throw new Error('Google OAuth client ID and secret are required.');
  }
  const state = randomNonce();

  return new Promise<SheetsTokens>((resolve, reject) => {
    let settled = false;
    const server = createServer();
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { server.close(); } catch { /* ignore */ }
      reject(new Error('OAuth flow timed out after 5 minutes.'));
    }, 5 * 60 * 1_000);

    function cleanup() {
      clearTimeout(timeoutId);
      try { server.close(); } catch { /* ignore */ }
    }

    server.on('request', async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${REDIRECT_HOST}`);
        if (url.pathname !== REDIRECT_PATH) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const error = url.searchParams.get('error');
        const receivedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');

        if (error) {
          res.statusCode = 400;
          res.end(htmlResponse('Sign-in cancelled', `<p>${error}</p><p>You can close this tab.</p>`));
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`OAuth error: ${error}`));
          }
          return;
        }

        if (receivedState !== state) {
          res.statusCode = 400;
          res.end(htmlResponse('Invalid state', '<p>CSRF check failed — sign-in aborted.</p>'));
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error('OAuth state mismatch (CSRF protection).'));
          }
          return;
        }

        if (!code) {
          res.statusCode = 400;
          res.end(htmlResponse('Missing code', '<p>No authorization code returned.</p>'));
          return;
        }

        const port = (server.address() as { port: number }).port;
        const client = new OAuth2Client({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          redirectUri: `http://${REDIRECT_HOST}:${port}${REDIRECT_PATH}`,
        });
        const { tokens } = await client.getToken(code);
        res.statusCode = 200;
        res.end(
          htmlResponse(
            'Signed in',
            '<p>Firestore Query Studio is now connected to Google Sheets.</p><p>You can close this tab.</p>',
          ),
        );
        if (!settled) {
          settled = true;
          cleanup();
          resolve(toSheetsTokens(tokens));
        }
      } catch (err) {
        res.statusCode = 500;
        res.end('OAuth callback failed.');
        if (!settled) {
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    void (async () => {
      try {
        const port = await listenEphemeral(server);
        const redirectUri = `http://${REDIRECT_HOST}:${port}${REDIRECT_PATH}`;
        const client = new OAuth2Client({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          redirectUri,
        });
        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          // Force prompt so a returning user still gets a refresh_token when
          // they previously revoked. Google otherwise suppresses it.
          prompt: 'consent',
          scope: SCOPES,
          state,
        });
        await shell.openExternal(authUrl);
      } catch (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
  });
}

function toSheetsTokens(tokens: Credentials): SheetsTokens {
  return {
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
    tokenType: tokens.token_type ?? null,
  };
}

/**
 * Builds an OAuth2Client primed with stored tokens. The returned client
 * auto-refreshes the access token using the refresh token when expired.
 * Callers pass it into `sheets({ auth })` from `googleapis`.
 */
export function clientFromStoredTokens(input: {
  clientId: string;
  clientSecret: string;
  tokens: SheetsTokens;
}): OAuth2Client {
  const client = new OAuth2Client({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });
  client.setCredentials({
    access_token: input.tokens.accessToken ?? undefined,
    refresh_token: input.tokens.refreshToken ?? undefined,
    expiry_date: input.tokens.expiryDate ?? undefined,
    scope: input.tokens.scope ?? undefined,
    token_type: input.tokens.tokenType ?? undefined,
  });
  return client;
}

export function hasValidTokens(tokens: SheetsTokens | null): boolean {
  return !!tokens?.refreshToken;
}
