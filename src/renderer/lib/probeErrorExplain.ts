/**
 * Turns raw SQL driver / probe IPC errors into copy users can act on, while
 * keeping the full server message for the "Technical details" fold-out.
 */
export type SqlProbeErrorExplanation = {
  title: string;
  body: string;
  /** Full string for the collapsible block (often the raw driver message). */
  technical: string;
  showTechnical: boolean;
  /** Short next step shown at the bottom of the card. */
  hint: string;
};

const DEFAULT_HINT =
  'You can still type the name in the field above — the list is only a shortcut.';

/**
 * Strips a leading `28000:` / `ETIMEDOUT:` style prefix so we do not show
 * the code twice in the body.
 */
function withoutDuplicateCodePrefix(code: string, message: string): string {
  const t = message.trim();
  if (t.startsWith(`${code}:`)) {
    return t.slice(code.length + 1).trim();
  }
  const m = /^([A-Z0-9_]{2,}|\d{5}):\s+(.+)/s.exec(t);
  if (m && m[1] === code) return m[2].trim();
  return t;
}

export function explainSqlProbeError(code: string, message: string): SqlProbeErrorExplanation {
  const msg = withoutDuplicateCodePrefix(code, message);
  const fullLower = `${code} ${msg}`.toLowerCase();

  if (code === 'UNSUPPORTED_IN_WEB' || fullLower.includes('desktop app')) {
    return {
      title: 'Not available in the browser',
      body: 'Loading databases and schemas from the server only works in the desktop app, where a direct connection to your database is possible. Run Firestore Query Studio on macOS, Windows, or Linux to use this feature.',
      technical: msg,
      showTechnical: false,
      hint: 'Type the database and schema names manually, or switch to the desktop app.',
    };
  }

  if (code === 'MISSING_INPUTS' || code === 'PROBE_MISSING_INPUTS') {
    return {
      title: 'Not enough to connect',
      body: 'Enter host, port, user, and password so the app can ask the server for a list. If you are editing a profile, your saved password in the keychain is used when the password field is left blank.',
      technical: msg,
      showTechnical: false,
      hint: DEFAULT_HINT,
    };
  }

  if (code === 'MISSING_DATABASE') {
    return {
      title: 'Choose a database first',
      body: 'Schema names are read from inside a specific database. Enter or select a database name, then try Load again.',
      technical: msg,
      showTechnical: false,
      hint: DEFAULT_HINT,
    };
  }

  if (
    code === '28000' ||
    fullLower.includes('pg_hba') ||
    fullLower.includes('no pg_hba')
  ) {
    const wantSsl = fullLower.includes('no encryption') || fullLower.includes('ssl off');
    return {
      title: 'Server blocked this list request',
      body: `The server’s access rules (pg_hba.conf) are not allowing the short connection this button uses to read the catalog${
        wantSsl
          ? ' — for example, this attempt may be unencrypted while your user or host is only allowed over TLS.'
          : " for this host, user, or target database (often the maintenance database \"postgres\" or \"template1\")."
      } A normal query to your own database can still work even when listing every database is not permitted.`,
      technical: message.trim(),
      showTechnical: true,
      hint: wantSsl
        ? 'Try SSL mode “require” or “verify-full” if the host requires encryption, or type the database name manually. If you manage the server, a DBA can adjust pg_hba.conf for this user and connection path.'
        : `${DEFAULT_HINT} If you manage the server, a DBA can adjust pg_hba.conf for this user and connection path.`,
    };
  }

  if (code === '28P01' || fullLower.includes('password authentication failed')) {
    return {
      title: 'Sign-in failed',
      body: 'The user name or password was rejected. Check credentials, and whether the password in your keychain is still the right one for this server.',
      technical: msg,
      showTechnical: true,
      hint: DEFAULT_HINT,
    };
  }

  if (
    code === '3D000' ||
    (fullLower.includes('database') && fullLower.includes('does not exist'))
  ) {
    return {
      title: 'Database not found on server',
      body: 'The server could not find the database that was used for the operation. The list might still be recoverable; otherwise type the name exactly as your DBA provided it.',
      technical: msg,
      showTechnical: true,
      hint: DEFAULT_HINT,
    };
  }

  if (code === 'ER_ACCESS_DENIED_ERROR' || (fullLower.includes('access denied') && fullLower.includes('user'))) {
    return {
      title: 'MySQL access denied',
      body: 'The account or password is not valid for this host, or the user is not allowed to list schemas from the information schema tables.',
      technical: msg,
      showTechnical: true,
      hint: DEFAULT_HINT,
    };
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    fullLower.includes('econnrefused') ||
    fullLower.includes('etimedout') ||
    fullLower.includes('getaddrinfo')
  ) {
    return {
      title: 'Could not reach the server',
      body: 'The connection attempt did not get a response in time, was refused, or the host name could not be resolved. Check the host, port, firewall, VPN, and that the server is up.',
      technical: msg,
      showTechnical: true,
      hint: DEFAULT_HINT,
    };
  }

  if (code === 'UNSUPPORTED_ENGINE') {
    return {
      title: 'Not available for this engine',
      body: 'This action is not defined for the selected database type (for example, MySQL uses one name for both "database" and "schema", so there is no separate schema list).',
      technical: msg,
      showTechnical: false,
      hint: DEFAULT_HINT,
    };
  }

  if (code === 'PROBE_FAILED') {
    return {
      title: 'Something went wrong',
      body: 'The app could not complete the request. See technical details for the original message — it often points to a permission, network, or server configuration issue.',
      technical: msg,
      showTechnical: true,
      hint: DEFAULT_HINT,
    };
  }

  return {
    title: 'Could not load from server',
    body: 'The server or driver returned an error. The details below can help you or a DBA diagnose access rules, credentials, or network issues.',
    technical: message.trim() || code,
    showTechnical: true,
    hint: DEFAULT_HINT,
  };
}
