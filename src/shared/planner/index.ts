/**
 * Shared planner / insights / chat entry point. Import from here in both the
 * Electron main process and the web renderer — everything here is pure
 * TypeScript with only `fetch` / DOM-ambient dependencies.
 */
export { extractJsonObject } from './jsonExtract';
export { queryPlanSystemPrompt } from './prompts/queryPlanSystem';
export { sqlQueryPlanSystemPrompt } from './prompts/sqlQueryPlanSystem';
export { insightsSystemPrompt } from './prompts/insightsSystem';
export { buildPlan, type BuildPlanDeps } from './planner';
export {
  buildSqlPlan,
  SqlPlanBuildOutcome,
  type BuildSqlPlanDeps,
  type SqlPlanRequest,
} from './sqlPlanner';
export { generateInsights, type GenerateInsightsDeps } from './insights';
export { generateVisuals, type GenerateVisualsDeps } from './visuals';
export { visualsSystemPrompt } from './prompts/visualsSystem';
export { openaiChat, type OpenAiChatSettings } from './openaiChat';
export {
  ChatBackendError,
  type ChatBackend,
  type ChatBackendErrorCode,
  type ChatBackendOptions,
  type ChatBackendResponse,
  type LlmMessage,
} from './types';
