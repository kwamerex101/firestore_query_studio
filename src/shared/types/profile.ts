import { z } from 'zod';

export const EnvTag = z.enum(['dev', 'staging', 'prod']);
export type EnvTag = z.infer<typeof EnvTag>;

/**
 * Which database product a profile points at. Existing on-disk profiles
 * predate this field, so every Firestore schema defaults it to 'firestore'
 * for backwards-compatible loads. The discriminator is explicit on the wire
 * and checked via `Profile.parse` to prevent drift between engines.
 */
export const Engine = z.enum([
  'firestore',
  'postgres',
  'mysql',
  'mssql',
  'bigquery',
  'file',
]);
export type Engine = z.infer<typeof Engine>;

export const ProfileKind = z.enum(['live', 'emulator']);
export type ProfileKind = z.infer<typeof ProfileKind>;

export const SslMode = z.enum(['disable', 'require', 'verify-full']);
export type SslMode = z.infer<typeof SslMode>;

// Firestore — live project via Admin SDK service account.
export const LiveProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.literal('firestore').default('firestore'),
  kind: z.literal('live'),
  envTag: EnvTag,
  projectId: z.string().min(1),
  serviceAccountPath: z.string().min(1),
  /**
   * Hard ceiling on how many documents the executor will stream in any
   * single run. Historically 50k; raised to 10M to enable export-to-disk
   * of large Firestore collections. The in-UI window is bounded
   * separately by `uiLimit` on the plan.
   */
  scanCap: z.number().int().positive().max(10_000_000).default(500),
  sampleSize: z.number().int().positive().max(200).default(10),
  /**
   * Safety ceiling on resident memory used by streaming buffers in the
   * main process for a single run (MiB). The streaming executor aborts
   * with a clear error when in-flight buffers exceed this.
   */
  maxMemoryMb: z.number().int().positive().max(8_192).default(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

// Firestore — local emulator.
export const EmulatorProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.literal('firestore').default('firestore'),
  kind: z.literal('emulator'),
  envTag: EnvTag,
  projectId: z.string().min(1),
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().positive().default(8080),
  scanCap: z.number().int().positive().max(10_000_000).default(500),
  sampleSize: z.number().int().positive().max(200).default(10),
  maxMemoryMb: z.number().int().positive().max(8_192).default(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const FirestoreProfile = z.discriminatedUnion('kind', [LiveProfile, EmulatorProfile]);
export type FirestoreProfile = z.infer<typeof FirestoreProfile>;

// PostgreSQL — network-reachable server. The plaintext password never lives
// on this blob; it goes through `secrets.ts` into the OS keychain and is
// referenced here only by the `hasPassword` flag.
export const PostgresProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.literal('postgres'),
  envTag: EnvTag,
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().positive().default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  /**
   * True if a password has been stored in the OS keychain for this profile.
   * The plaintext secret never leaves the main process.
   */
  hasPassword: z.boolean().default(false),
  sslMode: SslMode.default('disable'),
  schema: z.string().min(1).default('public'),
  /**
   * `statement_timeout` forwarded to Postgres for each query. Cloud managed
   * Postgres has its own ceiling; this is the app's best-effort cap.
   */
  queryTimeoutMs: z.number().int().positive().min(1_000).max(600_000).default(30_000),
  /**
   * Maximum rows the app will fetch in any single non-streaming query.
   * The classic `runReadOnlyQuery` path clamps here to keep the
   * materialized result bounded. Streaming exports are capped by
   * `hardLimit` on the request instead (up to 10M), so raising this
   * does not on its own make 500k-row single-payload responses safe.
   */
  defaultLimit: z.number().int().positive().max(10_000_000).default(500),
  /**
   * Safety ceiling on resident memory used by streaming buffers in the
   * main process for a single run (MiB). The streaming executor aborts
   * with a clear error when in-flight buffers exceed this.
   */
  maxMemoryMb: z.number().int().positive().max(8_192).default(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type PostgresProfile = z.infer<typeof PostgresProfile>;

// MySQL / MariaDB — network-reachable server. Password handling is identical
// to Postgres: the plaintext secret goes to the OS keychain via `secrets.ts`
// and only the `hasPassword` flag lives on the profile blob.
export const MysqlProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.literal('mysql'),
  envTag: EnvTag,
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().positive().default(3306),
  database: z.string().min(1),
  user: z.string().min(1),
  hasPassword: z.boolean().default(false),
  /**
   * `disable` = no TLS, `require` = TLS with no cert verification (fine for
   * managed MySQL like PlanetScale, RDS default), `verify-full` = verify the
   * server certificate chain. Mirrors the Postgres semantics on purpose.
   */
  sslMode: SslMode.default('disable'),
  /**
   * `SET SESSION MAX_EXECUTION_TIME = N` (MySQL 5.7+) / statement timeout
   * forwarded per query. Cloud-managed MySQL has its own ceiling; this is
   * the app's best-effort cap.
   */
  queryTimeoutMs: z.number().int().positive().min(1_000).max(600_000).default(30_000),
  defaultLimit: z.number().int().positive().max(10_000_000).default(500),
  maxMemoryMb: z.number().int().positive().max(8_192).default(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type MysqlProfile = z.infer<typeof MysqlProfile>;

// Microsoft SQL Server — network-reachable server. Uses `tedious` under the
// hood; `encrypt`/`trustServerCertificate` map directly onto tedious options.
export const MssqlProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.literal('mssql'),
  envTag: EnvTag,
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().positive().default(1433),
  database: z.string().min(1),
  user: z.string().min(1),
  hasPassword: z.boolean().default(false),
  /**
   * Azure SQL / managed instances require TLS; many on-prem installs use a
   * self-signed cert. `encrypt` turns TLS on, `trustServerCertificate` skips
   * chain verification. These map 1:1 to the underlying tedious options.
   */
  encrypt: z.boolean().default(true),
  trustServerCertificate: z.boolean().default(false),
  /**
   * Named instance (e.g. `SQLEXPRESS`). Leave blank for default instances.
   * When set, tedious uses the SQL Server Browser to resolve the real port,
   * so the configured `port` is effectively ignored.
   */
  instanceName: z.string().optional(),
  /**
   * Request timeout in ms forwarded as `requestTimeout` to tedious.
   */
  queryTimeoutMs: z.number().int().positive().min(1_000).max(600_000).default(30_000),
  defaultLimit: z.number().int().positive().max(10_000_000).default(500),
  maxMemoryMb: z.number().int().positive().max(8_192).default(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type MssqlProfile = z.infer<typeof MssqlProfile>;

// Google BigQuery — serverless cloud data warehouse. Auth is via Google
// Application Default Credentials (ADC): either a service-account JSON file
// or the gcloud SDK credentials on the signed-in developer machine. There's
// no host/port/user/password — just a project id and optional default
// dataset to scope dataset listings.
export const BigQueryProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.literal('bigquery'),
  envTag: EnvTag,
  projectId: z.string().min(1),
  /** Optional service-account JSON. Blank = let BigQuery use ADC. */
  serviceAccountPath: z.string().default(''),
  /** Default dataset to scope planner suggestions + table picker. Blank = all datasets. */
  defaultDataset: z.string().default(''),
  /** BigQuery billing location (US, EU, us-central1…). Inferred when blank. */
  location: z.string().default(''),
  queryTimeoutMs: z.number().int().positive().min(1_000).max(600_000).default(60_000),
  defaultLimit: z.number().int().positive().max(10_000_000).default(500),
  maxMemoryMb: z.number().int().positive().max(8_192).default(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type BigQueryProfile = z.infer<typeof BigQueryProfile>;

/**
 * CSV / XLSX-backed profile.
 *
 * On create we parse the uploaded file into a per-profile SQLite database
 * living in the app's user-data dir. Each sheet (XLSX) or the one CSV
 * becomes a SQLite table. Queries are then just regular SQL over that
 * SQLite file — the profile implements the existing `SqlDriver`
 * interface, so the NL→SQL planner + execution UI work unchanged.
 */
export const FileProfileKind = z.enum(['csv', 'xlsx']);
export type FileProfileKind = z.infer<typeof FileProfileKind>;

export const FileProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.literal('file'),
  envTag: EnvTag,
  /** Source file kind — used for re-parsing on refresh. */
  kind: FileProfileKind,
  /** Absolute path to the source file at import time. Kept for "refresh" and display. */
  sourcePath: z.string().min(1),
  /** Friendly source filename (derived from sourcePath; stored for display). */
  sourceName: z.string().min(1),
  /** Absolute path to the SQLite database we materialized for this profile. */
  sqlitePath: z.string().min(1),
  /** Names of tables created inside the SQLite file. */
  tables: z.array(z.string()).default([]),
  /** Size of the imported source file in bytes. */
  sizeBytes: z.number().int().nonnegative().default(0),
  /** Row totals per table (approximate; captured at import time). */
  rowCounts: z.record(z.number().int().nonnegative()).default({}),
  queryTimeoutMs: z.number().int().positive().min(1_000).max(600_000).default(30_000),
  defaultLimit: z.number().int().positive().max(10_000_000).default(500),
  maxMemoryMb: z.number().int().positive().max(8_192).default(512),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type FileProfile = z.infer<typeof FileProfile>;

/**
 * Top-level profile union. Using `z.union` (not `z.discriminatedUnion`) so
 * that legacy on-disk profiles without the `engine` field still parse via
 * the Firestore variants' `.default('firestore')`.
 */
export const Profile = z.union([
  LiveProfile,
  EmulatorProfile,
  PostgresProfile,
  MysqlProfile,
  MssqlProfile,
  BigQueryProfile,
  FileProfile,
]);
export type Profile = z.infer<typeof Profile>;
export type LiveProfile = z.infer<typeof LiveProfile>;
export type EmulatorProfile = z.infer<typeof EmulatorProfile>;

export const LiveProfileInput = LiveProfile.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({ scanCap: true, sampleSize: true, maxMemoryMb: true, engine: true });

export const EmulatorProfileInput = EmulatorProfile.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  scanCap: true,
  sampleSize: true,
  maxMemoryMb: true,
  host: true,
  port: true,
  engine: true,
});

export const FirestoreProfileInput = z.discriminatedUnion('kind', [
  LiveProfileInput,
  EmulatorProfileInput,
]);
export type FirestoreProfileInput = z.infer<typeof FirestoreProfileInput>;

export const PostgresProfileInput = PostgresProfile
  .omit({
    id: true,
    hasPassword: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    /**
     * Plaintext password, traversed through IPC exactly once on
     * create/update. The main process writes it to the OS keychain and
     * never returns it. Empty string / undefined = "leave existing secret
     * untouched".
     */
    password: z.string().optional(),
  })
  .partial({
    host: true,
    port: true,
    sslMode: true,
    schema: true,
    queryTimeoutMs: true,
    defaultLimit: true,
    maxMemoryMb: true,
  });
export type PostgresProfileInput = z.infer<typeof PostgresProfileInput>;

export const MysqlProfileInput = MysqlProfile
  .omit({
    id: true,
    hasPassword: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    password: z.string().optional(),
  })
  .partial({
    host: true,
    port: true,
    sslMode: true,
    queryTimeoutMs: true,
    defaultLimit: true,
    maxMemoryMb: true,
  });
export type MysqlProfileInput = z.infer<typeof MysqlProfileInput>;

export const MssqlProfileInput = MssqlProfile
  .omit({
    id: true,
    hasPassword: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    password: z.string().optional(),
  })
  .partial({
    host: true,
    port: true,
    encrypt: true,
    trustServerCertificate: true,
    instanceName: true,
    queryTimeoutMs: true,
    defaultLimit: true,
    maxMemoryMb: true,
  });
export type MssqlProfileInput = z.infer<typeof MssqlProfileInput>;

/**
 * Input shape for creating a file-backed profile. The renderer only knows
 * the source path (from an Electron open dialog) + kind; the main process
 * handles the actual parse-to-SQLite step and fills in the derived fields
 * before persisting the Profile.
 */
export const FileProfileInput = z.object({
  name: z.string().min(1),
  engine: z.literal('file'),
  envTag: EnvTag,
  kind: FileProfileKind,
  sourcePath: z.string().min(1),
  queryTimeoutMs: z.number().int().positive().min(1_000).max(600_000).optional(),
  defaultLimit: z.number().int().positive().max(10_000_000).optional(),
});
export type FileProfileInput = z.infer<typeof FileProfileInput>;

export const BigQueryProfileInput = BigQueryProfile
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({
    serviceAccountPath: true,
    defaultDataset: true,
    location: true,
    queryTimeoutMs: true,
    defaultLimit: true,
    maxMemoryMb: true,
  });
export type BigQueryProfileInput = z.infer<typeof BigQueryProfileInput>;

export const ProfileInput = z.union([
  LiveProfileInput,
  EmulatorProfileInput,
  PostgresProfileInput,
  MysqlProfileInput,
  MssqlProfileInput,
  BigQueryProfileInput,
  FileProfileInput,
]);
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ProfileUpdate = z
  .object({
    name: z.string().min(1).optional(),
    envTag: EnvTag.optional(),

    // Firestore
    projectId: z.string().min(1).optional(),
    serviceAccountPath: z.string().min(1).optional(),
    scanCap: z.number().int().positive().max(10_000_000).optional(),
    sampleSize: z.number().int().positive().max(200).optional(),

    // Shared (Firestore emulator + Postgres/MySQL/MSSQL)
    host: z.string().min(1).optional(),
    port: z.number().int().positive().optional(),

    // Postgres / MySQL / MSSQL shared
    database: z.string().min(1).optional(),
    user: z.string().min(1).optional(),
    /** Pass `null` to clear a stored password; `undefined`/missing = no change. */
    password: z.string().nullable().optional(),
    queryTimeoutMs: z.number().int().positive().min(1_000).max(600_000).optional(),
    defaultLimit: z.number().int().positive().max(10_000_000).optional(),
    /** Streaming buffer memory ceiling for large runs (MiB). */
    maxMemoryMb: z.number().int().positive().max(8_192).optional(),

    // Postgres / MySQL
    sslMode: SslMode.optional(),

    // Postgres only
    schema: z.string().min(1).optional(),

    // MSSQL only
    encrypt: z.boolean().optional(),
    trustServerCertificate: z.boolean().optional(),
    instanceName: z.string().optional(),

    // BigQuery only
    defaultDataset: z.string().optional(),
    location: z.string().optional(),
  })
  .strict();
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const LlmSettings = z.object({
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  // Request timeout in milliseconds. Cloud APIs usually finish in < 5s, but
  // local models (Ollama, LM Studio) need longer, especially on a cold start.
  timeoutMs: z.number().int().positive().min(1_000).max(600_000).default(30_000),
});
export type LlmSettings = z.infer<typeof LlmSettings>;

export const LlmProvider = z.enum(['openai-compat', 'cursor-cli', 'claude-cli']);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const CursorMode = z.enum(['default', 'plan', 'ask']);
export type CursorMode = z.infer<typeof CursorMode>;

export const CursorSettings = z.object({
  command: z.string().min(1).default('cursor-agent'),
  model: z.string().min(1).default('auto'),
  mode: CursorMode.default('default'),
  extraArgs: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  envVars: z.record(z.string()).default({}),
  // Cursor CLI cold starts can take a while; keep the default generous.
  timeoutMs: z.number().int().positive().min(1_000).max(600_000).default(60_000),
});
export type CursorSettings = z.infer<typeof CursorSettings>;

/**
 * Permission mode passed to the Claude CLI's `--permission-mode` flag.
 * Planner calls should always use `plan` or `acceptEdits` sparingly since we
 * only ever read the model's text response — tool execution isn't wired up.
 */
export const ClaudePermissionMode = z.enum([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
]);
export type ClaudePermissionMode = z.infer<typeof ClaudePermissionMode>;

/**
 * Google Sheets export credentials. The user supplies their own OAuth
 * client ID + secret from Google Cloud Console (Desktop app client type)
 * so we never ship app-wide credentials into an open-source repo.
 */
export const GoogleSheetsSettings = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type GoogleSheetsSettings = z.infer<typeof GoogleSheetsSettings>;

export const GoogleSheetsTokens = z.object({
  accessToken: z.string().nullable(),
  refreshToken: z.string().nullable(),
  expiryDate: z.number().nullable(),
  scope: z.string().nullable(),
  tokenType: z.string().nullable(),
});
export type GoogleSheetsTokens = z.infer<typeof GoogleSheetsTokens>;

export const ClaudeSettings = z.object({
  /** Executable path. `claude` relies on PATH resolution. */
  command: z.string().min(1).default('claude'),
  /** Model alias (`sonnet`, `opus`, `haiku`) or full model id. `auto` = CLI default. */
  model: z.string().min(1).default('sonnet'),
  /** Permission mode handed to the CLI. */
  permissionMode: ClaudePermissionMode.default('default'),
  /** Extra CLI flags; forwarded verbatim after our built-in args. */
  extraArgs: z.array(z.string()).default([]),
  /** Working directory for the spawned process. */
  cwd: z.string().optional(),
  /** Env vars exposed to the Claude CLI process (e.g. `ANTHROPIC_API_KEY`). */
  envVars: z.record(z.string()).default({}),
  /** Claude CLI cold starts can be slow on first run; default 60s. */
  timeoutMs: z.number().int().positive().min(1_000).max(600_000).default(60_000),
});
export type ClaudeSettings = z.infer<typeof ClaudeSettings>;

// Narrowing helpers used across the main process and renderer.
export function isFirestoreProfile(p: Profile): p is FirestoreProfile {
  return p.engine === 'firestore';
}
export function isPostgresProfile(p: Profile): p is PostgresProfile {
  return p.engine === 'postgres';
}
export function isMysqlProfile(p: Profile): p is MysqlProfile {
  return p.engine === 'mysql';
}
export function isMssqlProfile(p: Profile): p is MssqlProfile {
  return p.engine === 'mssql';
}
export function isBigQueryProfile(p: Profile): p is BigQueryProfile {
  return p.engine === 'bigquery';
}
export function isFileProfile(p: Profile): p is FileProfile {
  return p.engine === 'file';
}

/**
 * A "SQL-ish" profile — any engine that speaks a relational dialect via
 * the shared SQL driver interface (`src/main/drivers/types.ts`). Keeps
 * callers from juggling three separate type guards.
 */
export type SqlProfile =
  | PostgresProfile
  | MysqlProfile
  | MssqlProfile
  | BigQueryProfile
  | FileProfile;
export function isSqlProfile(p: Profile): p is SqlProfile {
  return (
    p.engine === 'postgres' ||
    p.engine === 'mysql' ||
    p.engine === 'mssql' ||
    p.engine === 'bigquery' ||
    p.engine === 'file'
  );
}

/**
 * Dialect string used by the shared SQL planner / executor. Equivalent to
 * `SqlProfile['engine']` but exported separately so shared/renderer code
 * can import it without dragging the profile schemas along. File-backed
 * profiles use the `sqlite` dialect under the hood.
 */
export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'bigquery' | 'sqlite';
