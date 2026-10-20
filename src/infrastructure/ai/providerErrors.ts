const TRANSIENT_CODES = new Set<string>(["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH"]);

interface ErrorLike {
  message?: string;
  name?: string;
  status?: number;
  statusCode?: number;
  code?: string;
  response?: {
    status?: number;
    statusCode?: number;
  };
  cause?: {
    message?: string;
    code?: string;
  };
}

function errorText(error: unknown): string {
  const err = error as ErrorLike;
  return `${err?.message || ""} ${err?.cause?.message || ""}`.toLowerCase();
}

export function providerStatusCode(error: unknown): number {
  const err = error as ErrorLike;
  const explicitStatus = Number(
    err?.status || err?.statusCode || err?.response?.status || err?.response?.statusCode,
  );
  if (Number.isFinite(explicitStatus) && explicitStatus > 0) return explicitStatus;
  const match = errorText(error).match(/\b(400|401|403|404|408|422|429|498|5\d\d)\b/);
  return match ? Number(match[1]) : 0;
}

export function isTransientProviderError(error: unknown): boolean {
  const err = error as ErrorLike;
  const status = providerStatusCode(error);
  const code = String(err?.code || err?.cause?.code || "").toUpperCase();
  const text = errorText(error);
  if (
    err?.name === "AbortError" ||
    err?.name === "TimeoutError" ||
    status === 408 ||
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ECONNABORTED"].includes(code)
  )
    return false;
  if (status === 429 || status >= 500) return true;
  if (text.includes("timed out") || text.includes("timeout")) return false;
  return (
    TRANSIENT_CODES.has(code) ||
    text.includes("fetch failed") ||
    text.includes("socket hang up") ||
    text.includes("network error")
  );
}

export interface ClassifiedProviderError {
  code: string;
  message: string;
}

export function classifyProviderError(
  error: unknown,
  providerName = "AI provider",
): ClassifiedProviderError {
  const err = error as ErrorLike;
  const status = providerStatusCode(error);
  const code = String(err?.code || err?.cause?.code || "").toUpperCase();
  const text = errorText(error);
  const providerLabels: Record<string, string> = {
    gemini: "Gemini",
    groq: "Groq",
    anthropic: "Anthropic",
  };
  const label = providerLabels[providerName] || "The selected AI provider";

  if (status === 429 || code === "RESOURCE_EXHAUSTED" || text.includes("resource_exhausted")) {
    return {
      code: "AI_PROVIDER_RATE_LIMITED",
      message: `${label} has reached a request or quota limit. Wait briefly, then retry or check the provider's usage limits.`,
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    code === "INVALID_API_KEY" ||
    text.includes("api key not valid")
  ) {
    return {
      code: "AI_PROVIDER_CONFIGURATION",
      message: `${label} rejected the configured API key or project access. Check the backend API key and enabled model permissions.`,
    };
  }
  if (
    status === 404 ||
    text.includes("model not found") ||
    text.includes("not found for api version")
  ) {
    return {
      code: "AI_PROVIDER_MODEL_UNAVAILABLE",
      message: `${label} does not recognize the configured model. Check the model ID against the provider catalog.`,
    };
  }
  if (status === 400 || status === 422) {
    return {
      code: "AI_PROVIDER_INVALID_REQUEST",
      message: `${label} rejected the request settings for this model. Check that the selected model supports the configured parameters.`,
    };
  }
  if (
    err?.name === "AbortError" ||
    err?.name === "TimeoutError" ||
    status === 408 ||
    code === "ETIMEDOUT"
  ) {
    return {
      code: "AI_PROVIDER_TIMEOUT",
      message: `${label} took too long to respond. Retry the same message.`,
    };
  }
  if (
    TRANSIENT_CODES.has(code) ||
    text.includes("fetch failed") ||
    text.includes("network error") ||
    text.includes("socket hang up")
  ) {
    return {
      code: "AI_PROVIDER_NETWORK_ERROR",
      message: `JobScout could not connect to ${label}. Check the backend's outbound internet access, then retry.`,
    };
  }
  if (status === 498 || code === "CAPACITY_EXCEEDED" || text.includes("capacity_exceeded")) {
    return {
      code: "AI_PROVIDER_CAPACITY",
      message: `${label} is temporarily at capacity. Wait briefly and retry.`,
    };
  }
  if (status >= 500) {
    return {
      code: "AI_PROVIDER_UNAVAILABLE",
      message: `${label} is temporarily unavailable. Retry shortly; if it continues, contact support with the request ID.`,
    };
  }
  return {
    code: "AI_PROVIDER_ERROR",
    message: `${label} could not complete this response. Retry shortly; if it continues, contact support with the request ID.`,
  };
}

export interface RetryOptions {
  delayMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (retries: number, error: unknown) => void;
}

export async function invokeWithTransientRetry<T>(
  invoke: () => Promise<T>,
  {
    delayMs = 250,
    maxRetries = 1,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRetry,
  }: RetryOptions = {},
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await invoke();
    } catch (error) {
      if (!isTransientProviderError(error) || retries >= maxRetries) throw error;
      retries += 1;
      onRetry?.(retries, error);
      await sleep(delayMs);
    }
  }
}
