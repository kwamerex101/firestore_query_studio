import { z } from 'zod';

export const EnvTag = z.enum(['dev', 'staging', 'prod']);
export type EnvTag = z.infer<typeof EnvTag>;

export const ProfileKind = z.enum(['live', 'emulator']);
export type ProfileKind = z.infer<typeof ProfileKind>;

export const LiveProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal('live'),
  envTag: EnvTag,
  projectId: z.string().min(1),
  serviceAccountPath: z.string().min(1),
  scanCap: z.number().int().positive().max(50_000).default(500),
  sampleSize: z.number().int().positive().max(200).default(10),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const EmulatorProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal('emulator'),
  envTag: EnvTag,
  projectId: z.string().min(1),
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().positive().default(8080),
  scanCap: z.number().int().positive().max(50_000).default(500),
  sampleSize: z.number().int().positive().max(200).default(10),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const Profile = z.discriminatedUnion('kind', [LiveProfile, EmulatorProfile]);
export type Profile = z.infer<typeof Profile>;
export type LiveProfile = z.infer<typeof LiveProfile>;
export type EmulatorProfile = z.infer<typeof EmulatorProfile>;

export const LiveProfileInput = LiveProfile.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({ scanCap: true, sampleSize: true });

export const EmulatorProfileInput = EmulatorProfile.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({ scanCap: true, sampleSize: true, host: true, port: true });

export const ProfileInput = z.discriminatedUnion('kind', [LiveProfileInput, EmulatorProfileInput]);
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ProfileUpdate = z
  .object({
    name: z.string().min(1).optional(),
    envTag: EnvTag.optional(),
    projectId: z.string().min(1).optional(),
    serviceAccountPath: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().positive().optional(),
    scanCap: z.number().int().positive().max(50_000).optional(),
    sampleSize: z.number().int().positive().max(200).optional(),
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

export const LlmProvider = z.enum(['openai-compat', 'cursor-cli']);
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
