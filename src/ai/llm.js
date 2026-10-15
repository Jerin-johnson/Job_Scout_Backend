import CircuitBreaker from "opossum";
import { env } from "../config/env.js";
import { getLLMProvider } from "./providers/index.js";
import { getChatModelProvider } from "./modelCatalog.js";
import { quotaService } from "../services/quotaService.js";
import { logger } from "../shared/utils/logger.js";
import { PLANS } from "../shared/constants/plans.js";
import { invokeWithTransientRetry } from "./providerErrors.js";

// Circuit breaker options
const breakerOptions = {
  timeout: 30000, // 30s timeout per call
  errorThresholdPercentage: 50,
  resetTimeout: 10000, // try again after 10s
};

/**
 * Low-level execution function protected by circuit breaker
 */
async function executeModelCall({ model, messages, signal }) {
  return model.invoke(messages, { signal });
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
}) {
  const messages = [];

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

/**
 * Central LLM invocation wrapper - ALL models MUST be invoked through this function.
 *
 * @param {Object} options
 * @param {Object} options.user - Candidate user object
 * @param {string} options.tier - "small" (Haiku) or "strong" (Sonnet)
 * @param {string} options.feature - Feature identifier (chat, tailor_resume, match_jobs, interview_prep)
 * @param {Array|Object} options.prompt - Pre-formatted messages array or prompt parameters for formatCachedPrompt
 * @param {Object} [options.schema] - Optional Zod schema for structured output
 * @param {number} [options.maxTokens] - Max output tokens
 * @param {number} [options.temperature] - Temperature (default 0)
 * @param {AbortSignal} [options.signal] - Abort controller signal
 * @returns {Promise<any>}
 */
export async function invokeLLM({
  user,
  tier = "small",
  feature = "chat",
  prompt,
  schema = null,
  maxTokens = 2000,
  temperature = 0,
  signal = null,
  modelId = null,
}) {
  const start = performance.now();

  // 1. Quota & Budget Pre-Flight Verification
  if (user) {
    await quotaService.checkQuota(user, feature);
  }

  // 2. Resolve Model Name from Environment
  const selectedProvider = modelId ? getChatModelProvider(modelId) : null;
  if (modelId && (feature !== "chat" || !selectedProvider)) {
    throw new Error("The selected model is unavailable for this feature.");
  }
  const provider = selectedProvider || getLLMProvider(env.LLM_PROVIDER);
  const modelName = modelId || provider.modelForTier(tier);

  // 3. Prepare messages
  const messages = Array.isArray(prompt) ? prompt : formatCachedPrompt(prompt);

  // 4. Check if live Anthropic key is available or in mock/offline mode
  const isMockMode = !provider.isConfigured();

  if (isMockMode) {
    const latencyMs = Math.round(performance.now() - start);

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
        };
      }
      // General schema fallback mock
      return { mockGenerated: true, feature, modelName };
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
      });
    }

    return mockOutput;
  }

  // 5. Construct ChatAnthropic instance
  const modelInstance = provider.createModel({ modelName, temperature, maxTokens, schema });

  // 6. Execute model call through Opossum Circuit Breaker with exponential backoff & jitter
  let result;
  let attempts = 0;
  const maxRetries = 2;

  while (attempts <= maxRetries) {
    try {
      result = await llmBreaker.fire({
        model: modelInstance,
        messages,
        signal,
      });
      break;
    } catch (err) {
      if (signal?.aborted) {
        throw err; // don't retry aborted calls
      }

      attempts++;
      if (attempts > maxRetries) {
        logger.error({ modelName, feature, attempts }, "LLM invocation failed after retries");
        throw new Error("AI service temporarily unavailable.");
      }

      // Exponential backoff with jitter: 200ms * 2^attempts + random(50ms)
      const delay = Math.pow(2, attempts) * 200 + Math.floor(Math.random() * 50);
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  const latencyMs = Math.round(performance.now() - start);

  // 7. Calculate Tokens & Cost Telemetry
  const usage = result?.response_metadata?.usage || {};
  const inputTokens = usage.input_tokens || 100;
  const outputTokens = usage.output_tokens || 100;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens || 0;

  const costUsd = provider.estimateCostUsd(modelName, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });

  // 8. Record Telemetry Asynchronously
  if (user) {
    quotaService
      .recordUsage({
        userId: user._id || user.id,
        userPlan: user.plan || PLANS.FREE,
        feature,
        model: modelName,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd,
        latencyMs,
      })
      .catch((err) => {
        logger.error({ err: err.message }, "Error recording usage telemetry");
      });
  }

  return result;
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
}

function approximateTokens(messages) {
  const chars = messages.reduce((sum, message) => sum + messageText(message.content).length, 0);
  return Math.ceil(chars / 4);
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
}) {
  const startedAt = performance.now();
  if (user) await quotaService.checkQuota(user, feature);
  const selectedProvider = modelId ? getChatModelProvider(modelId) : null;
  if (modelId && (feature !== "chat" || !selectedProvider)) {
    throw new Error("The selected model is unavailable for this feature.");
  }
  const provider = selectedProvider || getLLMProvider(env.LLM_PROVIDER);
  const modelName = modelId || provider.modelForTier(tier);
  const messages = Array.isArray(prompt) ? prompt : formatCachedPrompt(prompt);
  const mockMode = !provider.isConfigured();
  let inputTokens = 0;
  let outputTokens = 0;
  let outputText = "";
  let firstTokenLatencyMs = null;

  if (mockMode) {
    const mockText = `[JobScout AI Mock Response for ${feature} via ${modelName}]`;
    for (let index = 0; index < mockText.length; index += 12) {
      if (signal?.aborted) throw signal.reason || new Error("Request cancelled");
      const text = mockText.slice(index, index + 12);
      outputText += text;
      firstTokenLatencyMs ??= Math.round(performance.now() - startedAt);
      yield { text };
    }
    inputTokens = 0;
    outputTokens = 0;
  } else {
    const model = provider.createModel({ modelName, temperature, maxTokens, schema: null });
    if (typeof model.stream !== "function") {
      const response = await invokeWithTransientRetry(() => model.invoke(messages, { signal }));
      const content = typeof response === "string" ? response : messageText(response?.content);
      outputText = content;
      firstTokenLatencyMs = Math.round(performance.now() - startedAt);
      yield { text: content };
    } else {
      const stream = model.stream(messages, { signal });
      let emitted = false;
      try {
        for await (const chunk of stream) {
          if (signal?.aborted) throw signal.reason || new Error("Request cancelled");
          const text = messageText(chunk?.content);
          if (text) {
            emitted = true;
            outputText += text;
            firstTokenLatencyMs ??= Math.round(performance.now() - startedAt);
            yield { text };
          }
          inputTokens = chunk?.usage_metadata?.input_tokens ?? inputTokens;
          outputTokens = chunk?.usage_metadata?.output_tokens ?? outputTokens;
        }
      } catch (error) {
        if (emitted || signal?.aborted) throw error;
        const response = await invokeWithTransientRetry(() => model.invoke(messages, { signal }));
        outputText = messageText(response?.content);
        firstTokenLatencyMs = Math.round(performance.now() - startedAt);
        yield { text: outputText };
        inputTokens = response?.usage_metadata?.input_tokens || 0;
        outputTokens = response?.usage_metadata?.output_tokens || 0;
      }
      // LangChain's Google adapter surfaces usage on the final chunk when supported.
      if (inputTokens === 0) inputTokens = approximateTokens(messages);
      if (outputTokens === 0) outputTokens = Math.ceil(outputText.length / 4);
    }
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const usageIsEstimated = !mockMode && (inputTokens === 0 || outputTokens === 0);
  const costUsd = provider.estimateCostUsd(modelName, { inputTokens, outputTokens });
  if (user && !mockMode) {
    quotaService.recordUsage({
      userId: user._id || user.id,
      userPlan: user.plan || PLANS.FREE,
      feature,
      model: modelName,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd,
      latencyMs,
    }).catch(() => {});
  }
  yield {
    done: true,
    usage: { inputTokens, outputTokens, usageIsEstimated, costUsd },
    latencyMs,
    firstTokenLatencyMs,
  };
}
