import CircuitBreaker from "opossum";
import { env } from "../config/env.js";
import { getLLMProvider } from "./providers/index.js";
import { getChatModelProvider } from "./modelCatalog.js";
import { quotaService } from "../services/quotaService.js";
import { logger } from "../shared/utils/logger.js";
import { PLANS } from "../shared/constants/plans.js";
import { invokeWithTransientRetry } from "./providerErrors.js";
import { getModelRate } from "./modelPricingCatalog.js";
import { personalDataPolicyError } from "../config/aiStartupValidation.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Circuit breaker options
const breakerOptions = {
  timeout: 30000, // 30s timeout per call
  errorThresholdPercentage: 50,
  resetTimeout: 10000, // try again after 10s
};

export interface InvokableModel {
  invoke: (messages: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
  stream?: (messages: unknown, options?: { signal?: AbortSignal }) => AsyncIterable<unknown>;
  [key: string]: unknown;
}

export interface ModelCallParams {
  model: InvokableModel;
  messages: unknown;
  signal?: AbortSignal | null;
}

/**
 * Low-level execution function protected by circuit breaker
 */
export async function executeModelCall({ model, messages, signal }: ModelCallParams): Promise<unknown> {
  // LangChain expects either a real AbortSignal or no signal; null enters its
  // cancellation path and throws while removing an event listener.
  return model.invoke(messages, signal ? { signal } : {});
}

const llmBreaker = new CircuitBreaker(executeModelCall, breakerOptions);

llmBreaker.on("open", () => {
  logger.warn("LLM Circuit Breaker opened! Failing fast or using degraded responses.");
});

llmBreaker.on("halfOpen", () => {
  logger.info("LLM Circuit Breaker half-open; testing provider recovery.");
});

llmBreaker.on("close", () => {
  logger.info("LLM Circuit Breaker closed; provider healthy.");
});

export interface PromptTurn {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface FormatCachedPromptParams {
  systemPrompt: string;
  pinnedContext?: string;
  retrievedMemory?: string;
  conversationHistory?: PromptTurn[];
  userMessage: string;
}

/**
 * Format prompt messages according to strict Anthropic caching specification:
 * Order: [system] -> [pinned memory + profile facts] (cache breakpoint) -> [retrieved memory] -> [thread summary + last 4 turns] -> [user message]
 */
export function formatCachedPrompt({
  systemPrompt,
  pinnedContext = "",
  retrievedMemory = "",
  conversationHistory = [],
  userMessage,
}: FormatCachedPromptParams): PromptTurn[] {
  const messages: PromptTurn[] = [];

  // 1. Static System Prompt (Cache point 1)
  messages.push({
    role: "system",
    content: systemPrompt,
  });

  // 2. Pinned Context (Profile facts + core preferences) with Anthropic ephemeral cache control
  if (pinnedContext) {
    messages.push({
      role: "system",
      content: [
        {
          type: "text",
          text: `CANDIDATE_PROFILE_FACTS:\n${pinnedContext}`,
          cache_control: { type: "ephemeral" },
        },
      ],
    });
  }

  // 3. Retrieved Memory Context
  if (retrievedMemory) {
    messages.push({
      role: "system",
      content: `RETRIEVED_USER_PREFERENCES_AND_HISTORY:\n${retrievedMemory}`,
    });
  }

  // 4. Conversation History (Thread summary + last 4 turns)
  for (const turn of conversationHistory) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  // 5. Current User Message
  messages.push({
    role: "user",
    content: userMessage,
  });

  return messages;
}

export interface UserLike {
  _id?: unknown;
  id?: unknown;
  plan?: string;
  planVersion?: string;
  preferredName?: string;
  name?: string;
}

export interface UsageReport {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  usageIsEstimated: boolean;
  retryCount: number;
}

export interface MockResponderParams {
  messages: unknown;
  tools?: unknown;
  schema?: z.ZodTypeAny | null;
  modelName: string;
  feature: string;
}

export interface InvokeLLMOptions {
  user?: UserLike | null;
  tier?: string;
  feature?: string;
  prompt: unknown[] | FormatCachedPromptParams;
  schema?: z.ZodTypeAny | null;
  tools?: unknown;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal | null;
  modelId?: string | null;
  requestId?: string | null;
  onUsage?: ((usage: UsageReport) => void) | null;
  featureQuotaAccepted?: boolean;
  providerOverride?: {
    id: string;
    modelForTier: (tier: string) => string;
    isConfigured: () => boolean;
    estimateCostUsd: (modelName: string, tokens: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }) => number;
    createModel: (params: { modelName: string; temperature: number; maxTokens: number; schema?: unknown; tools?: unknown }) => InvokableModel;
  } | null;
  mockResponder?: ((params: MockResponderParams) => Promise<unknown>) | null;
}

/**
 * Central LLM invocation wrapper - ALL models MUST be invoked through this function.
 */
export async function invokeLLM<T = unknown>({
  user,
  tier = "small",
  feature = "chat",
  prompt,
  schema = null,
  tools = null,
  maxTokens = 2000,
  temperature = 0,
  signal = null,
  modelId = null,
  requestId = null,
  onUsage = null,
  featureQuotaAccepted = false,
  providerOverride = null,
  mockResponder = null,
}: InvokeLLMOptions): Promise<T> {
  const start = performance.now();
  const effectiveRequestId = requestId || randomUUID();

  // 2. Resolve Model Name from Environment
  const selectedProvider = modelId ? getChatModelProvider(modelId) : null;
  if (modelId && (feature !== "chat" || !selectedProvider)) {
    throw new Error("The selected model is unavailable for this feature.");
  }
  const provider = providerOverride || selectedProvider || getLLMProvider(env.LLM_PROVIDER);
  const modelName = modelId || provider.modelForTier(tier);
  const rate = getModelRate(provider.id, modelName);
  const policyError = personalDataPolicyError(provider.id, modelName, feature);
  if (policyError) throw policyError;

  // 3. Prepare messages
  const messages = Array.isArray(prompt) ? prompt : formatCachedPrompt(prompt);
  const inputRate = rate.inputUsdPerMillion ?? 0;
  const outputRate = rate.outputUsdPerMillion ?? 0;
  const estimatedCostUsd =
    (approximateTokens(messages) * inputRate + maxTokens * outputRate) /
    1_000_000;
  if (user)
    await quotaService.checkQuota(user, feature, { estimatedCostUsd, featureQuotaAccepted });
  else await quotaService.assertAIEnabled();

  // 4. Check if live Anthropic key is available or in mock/offline mode
  const isMockMode = !provider.isConfigured();
  if (isMockMode && !env.AI_ALLOW_MOCKS) {
    const error = new Error("The selected AI provider is not configured.") as Error & { statusCode?: number; code?: string };
    error.statusCode = 503;
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  if (isMockMode) {
    const latencyMs = Math.round(performance.now() - start);

    if (typeof mockResponder === "function") {
      const mockResult = await mockResponder({ messages, tools, schema, modelName, feature });
      const inputTokens = approximateTokens(messages);
      const outputTokens = approximateResultTokens(mockResult);
      if (user) {
        await quotaService.recordUsage({
          userId: user._id || user.id,
          userPlan: user.plan || PLANS.FREE,
          feature,
          model: modelName,
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          latencyMs,
        } as Parameters<typeof quotaService.recordUsage>[0]);
      }
      onUsage?.({
        provider: provider.id,
        model: modelName,
        inputTokens,
        outputTokens,
        costUsd: 0,
        usageIsEstimated: true,
        retryCount: 0,
      });
      return mockResult as T;
    }

    // Mock structured responses if schema was requested
    if (schema) {
      if (feature === "router_classify") {
        return {
          intent: "chat_simple",
          complexity: "low",
          needsTools: false,
          needsMemory: false,
          memoryTypes: [],
          confidence: 0.95,
          entities: {},
        } as T;
      }
      // General schema fallback mock
      return { mockGenerated: true, feature, modelName } as T;
    }

    // Mock text stream / response
    const mockOutput = `[JobScout AI Mock Response for ${feature} via ${modelName}]`;

    // Record mock telemetry
    if (user) {
      await quotaService.recordUsage({
        userId: user._id || user.id,
        userPlan: user.plan || PLANS.FREE,
        feature,
        model: modelName,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        latencyMs,
      } as Parameters<typeof quotaService.recordUsage>[0]);
    }

    return mockOutput as T;
  }

  // 5. Construct model instance
  const modelInstance = provider.createModel({
    modelName,
    temperature,
    maxTokens,
    schema: schema ? (schema as unknown as Record<string, unknown>) : undefined,
    tools: Array.isArray(tools) ? tools : undefined,
  }) as unknown as InvokableModel;
  const attemptId = randomUUID();
  let retryCount = 0;
  let result: unknown;
  try {
    result = await invokeWithTransientRetry(
      () => llmBreaker.fire({ model: modelInstance, messages, signal }),
      {
        maxRetries: env.AI_PROVIDER_MAX_RETRIES,
        onRetry: (count) => {
          retryCount = count;
        },
      },
    );
  } catch (error: unknown) {
    if (user) {
      const inputTokens = approximateTokens(messages);
      const costUsd = provider.estimateCostUsd(modelName, { inputTokens, outputTokens: 0 });
      await quotaService.recordUsage({
        userId: user._id || user.id,
        userPlan: user.plan || PLANS.FREE,
        planVersion: user.planVersion || "unversioned",
        feature,
        provider: provider.id,
        model: modelName,
        requestId: effectiveRequestId,
        attemptId,
        status: "failed",
        outcome: signal?.aborted ? "cancelled" : "provider_error",
        usageIsEstimated: true,
        inputTokens,
        outputTokens: 0,
        costUsd,
        latencyMs: Math.round(performance.now() - start),
        retryCount,
      } as Parameters<typeof quotaService.recordUsage>[0]);
    }
    throw error;
  }

  const latencyMs = Math.round(performance.now() - start);

  // 7. Calculate Tokens & Cost Telemetry
  const resultObj = result as {
    usage_metadata?: { input_tokens?: number; prompt_tokens?: number; output_tokens?: number; completion_tokens?: number; cache_read_input_tokens?: number; cached_input_tokens?: number; cache_creation_input_tokens?: number };
    response_metadata?: { usage?: { input_tokens?: number; prompt_tokens?: number; output_tokens?: number; completion_tokens?: number; cache_read_input_tokens?: number; cached_input_tokens?: number; cache_creation_input_tokens?: number } };
  };
  const usage = resultObj?.usage_metadata || resultObj?.response_metadata?.usage || {};
  const providerInputTokens = usage.input_tokens ?? usage.prompt_tokens;
  const providerOutputTokens = usage.output_tokens ?? usage.completion_tokens;
  const inputTokens = providerInputTokens ?? approximateTokens(messages);
  const outputTokens = providerOutputTokens ?? approximateResultTokens(result);
  const usageIsEstimated =
    providerInputTokens === null ||
    providerInputTokens === undefined ||
    providerOutputTokens === null ||
    providerOutputTokens === undefined;
  const cacheReadTokens = usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens || 0;

  const costUsd = provider.estimateCostUsd(modelName, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });

  // 8. Await the usage ledger write before returning a billable result.
  if (user) {
    await quotaService.recordUsage({
      userId: user._id || user.id,
      userPlan: user.plan || PLANS.FREE,
      planVersion: user.planVersion || "unversioned",
      feature,
      provider: provider.id,
      model: modelName,
      requestId: effectiveRequestId,
      attemptId,
      status: "success",
      outcome: "success",
      usageIsEstimated,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cachedInputTokens: cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      latencyMs,
      retryCount,
    } as Parameters<typeof quotaService.recordUsage>[0]);
  }
  onUsage?.({
    provider: provider.id,
    model: modelName,
    inputTokens,
    outputTokens,
    costUsd,
    usageIsEstimated,
    retryCount,
  });

  return result as T;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content.map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text || "")).join("\n");
}

function approximateTokens(messages: unknown[]): number {
  const chars = messages.reduce((sum: number, message: unknown) => {
    const msg = message as { content?: unknown };
    return sum + messageText(msg?.content).length;
  }, 0);
  return Math.ceil(chars / 4);
}

function approximateResultTokens(result: unknown): number {
  let text: string;
  if (typeof result === "string") text = result;
  else if (typeof (result as { content?: unknown })?.content === "string" || Array.isArray((result as { content?: unknown })?.content))
    text = messageText((result as { content?: unknown }).content);
  else {
    try {
      text = JSON.stringify(result ?? "");
    } catch {
      text = "";
    }
  }
  return Math.ceil(text.length / 4);
}

export interface StreamLLMOptions {
  user?: UserLike | null;
  tier?: string;
  feature?: string;
  prompt: unknown[] | FormatCachedPromptParams;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal | null;
  modelId?: string | null;
  requestId?: string | null;
  providerOverride?: {
    id: string;
    modelForTier: (tier: string) => string;
    isConfigured: () => boolean;
    estimateCostUsd: (modelName: string, tokens: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }) => number;
    createModel: (params: { modelName: string; temperature: number; maxTokens: number; schema?: unknown }) => InvokableModel;
  } | null;
}

export interface StreamChunkOutput {
  text?: string;
  done?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    usageIsEstimated: boolean;
    costUsd: number;
  };
  latencyMs?: number;
  firstTokenLatencyMs?: number | null;
}

/** Stream provider chunks and record aggregate usage after the response completes. */
export async function* streamLLM({
  user,
  tier = "small",
  feature = "chat",
  prompt,
  maxTokens = 1200,
  temperature = 0.2,
  signal = null,
  modelId = null,
  requestId = null,
  providerOverride = null,
}: StreamLLMOptions): AsyncGenerator<StreamChunkOutput, void, unknown> {
  const startedAt = performance.now();
  const effectiveRequestId = requestId || randomUUID();
  const selectedProvider = modelId ? getChatModelProvider(modelId) : null;
  if (modelId && (feature !== "chat" || !selectedProvider)) {
    throw new Error("The selected model is unavailable for this feature.");
  }
  const provider = providerOverride || selectedProvider || getLLMProvider(env.LLM_PROVIDER);
  const modelName = modelId || provider.modelForTier(tier);
  const rate = getModelRate(provider.id, modelName);
  const policyError = personalDataPolicyError(provider.id, modelName, feature);
  if (policyError) throw policyError;
  const messages = Array.isArray(prompt) ? prompt : formatCachedPrompt(prompt);
  const inputRate = rate.inputUsdPerMillion ?? 0;
  const outputRate = rate.outputUsdPerMillion ?? 0;
  const estimatedCostUsd =
    (approximateTokens(messages) * inputRate + maxTokens * outputRate) /
    1_000_000;
  if (user) await quotaService.checkQuota(user, feature, { estimatedCostUsd });
  else await quotaService.assertAIEnabled();
  const mockMode = !provider.isConfigured();
  if (mockMode && !env.AI_ALLOW_MOCKS) {
    const error = new Error("The selected AI provider is not configured.") as Error & { statusCode?: number; code?: string };
    error.statusCode = 503;
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let providerInputTokens: number | null = null;
  let providerOutputTokens: number | null = null;
  let cacheReadTokens = 0;
  let outputText = "";
  let firstTokenLatencyMs: number | null = null;
  let completed = false;
  let failure: unknown = null;
  let retryCount = 0;
  const attemptId = randomUUID();

  try {
    if (mockMode) {
      const mockText = `[JobScout AI Mock Response for ${feature} via ${modelName}]`;
      for (let index = 0; index < mockText.length; index += 12) {
        if (signal?.aborted) throw signal.reason || new Error("Request cancelled");
        const text = mockText.slice(index, index + 12);
        outputText += text;
        firstTokenLatencyMs ??= Math.round(performance.now() - startedAt);
        yield { text };
      }
    } else {
      const model = provider.createModel({
        modelName,
        temperature,
        maxTokens,
        schema: undefined,
      }) as unknown as InvokableModel;
      if (typeof model.stream !== "function") {
        const response = (await invokeWithTransientRetry(
          () => model.invoke(messages, signal ? { signal } : {}),
          {
            maxRetries: env.AI_PROVIDER_MAX_RETRIES,
            onRetry: (count) => {
              retryCount = count;
            },
          },
        )) as {
          content?: unknown;
          usage_metadata?: { input_tokens?: number; output_tokens?: number };
          response_metadata?: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
        };
        outputText = typeof response === "string" ? response : messageText(response?.content);
        providerInputTokens =
          response?.usage_metadata?.input_tokens ??
          response?.response_metadata?.usage?.input_tokens ??
          null;
        providerOutputTokens =
          response?.usage_metadata?.output_tokens ??
          response?.response_metadata?.usage?.output_tokens ??
          null;
        cacheReadTokens = response?.response_metadata?.usage?.cache_read_input_tokens ?? 0;
        firstTokenLatencyMs = Math.round(performance.now() - startedAt);
        yield { text: outputText };
      } else {
        for await (const rawChunk of model.stream(messages, signal ? { signal } : {})) {
          if (signal?.aborted) throw signal.reason || new Error("Request cancelled");
          const chunk = rawChunk as {
            content?: unknown;
            usage_metadata?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
          };
          const text = messageText(chunk?.content);
          if (text) {
            outputText += text;
            firstTokenLatencyMs ??= Math.round(performance.now() - startedAt);
            yield { text };
          }
          providerInputTokens = chunk?.usage_metadata?.input_tokens ?? providerInputTokens;
          providerOutputTokens = chunk?.usage_metadata?.output_tokens ?? providerOutputTokens;
          cacheReadTokens = chunk?.usage_metadata?.cache_read_input_tokens ?? cacheReadTokens;
        }
      }
    }
    if (signal?.aborted) throw signal.reason || new Error("Request cancelled");
    completed = true;
  } catch (error: unknown) {
    failure = error;
    throw error;
  } finally {
    if (user && !mockMode) {
      inputTokens = providerInputTokens ?? approximateTokens(messages);
      outputTokens = providerOutputTokens ?? approximateResultTokens(outputText);
      const usageIsEstimated =
        providerInputTokens === null ||
        providerInputTokens === undefined ||
        providerOutputTokens === null ||
        providerOutputTokens === undefined;
      const costUsd = provider.estimateCostUsd(modelName, {
        inputTokens,
        outputTokens,
        cacheReadTokens,
      });
      const status = completed ? "success" : outputText ? "partial" : "failed";
      const outcome = completed
        ? "success"
        : signal?.aborted
          ? "client_cancelled"
          : "provider_error";
      await quotaService.recordUsage({
        userId: user._id || user.id,
        userPlan: user.plan || PLANS.FREE,
        planVersion: user.planVersion || "unversioned",
        feature,
        provider: provider.id,
        model: modelName,
        requestId: effectiveRequestId,
        attemptId,
        status,
        outcome,
        usageIsEstimated,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cachedInputTokens: cacheReadTokens,
        costUsd,
        latencyMs: Math.round(performance.now() - startedAt),
        retryCount,
      } as Parameters<typeof quotaService.recordUsage>[0]);
    }
    if (failure && !user)
      logger.debug(
        { provider: provider.id, errorCode: (failure as { code?: string })?.code },
        "Unattributed stream request ended",
      );
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const usageIsEstimated =
    !mockMode &&
    (providerInputTokens === null ||
      providerInputTokens === undefined ||
      providerOutputTokens === null ||
      providerOutputTokens === undefined);
  inputTokens = providerInputTokens ?? approximateTokens(messages);
  outputTokens = providerOutputTokens ?? approximateResultTokens(outputText);
  const costUsd = provider.estimateCostUsd(modelName, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
  });
  yield {
    done: true,
    usage: { inputTokens, outputTokens, usageIsEstimated, costUsd },
    latencyMs,
    firstTokenLatencyMs,
  };
}
