import { AIConfig } from "./types";

export type AIClientErrorType = "timeout" | "upstream_http" | "network" | "parse_error" | "unknown";

export class AIClientError extends Error {
  type: AIClientErrorType;
  statusCode?: number;
  context?: Record<string, unknown>;

  constructor(type: AIClientErrorType, message: string, options?: { statusCode?: number; context?: Record<string, unknown> }) {
    super(message);
    this.name = "AIClientError";
    this.type = type;
    this.statusCode = options?.statusCode;
    this.context = options?.context;
  }

  toJSON() {
    return {
      type: this.type,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
    };
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toError(err: unknown): AIClientError {
  if (err instanceof AIClientError) return err;
  if (err instanceof TypeError) return new AIClientError("network", err.message);
  if (err instanceof Error) return new AIClientError("unknown", err.message);
  return new AIClientError("unknown", "Unknown AI client error", { context: { raw: String(err) } });
}

function formatErrorForDisplay(error: AIClientError): string {
  const statusPart = typeof error.statusCode === "number" ? ` status=${error.statusCode}` : "";
  return `[${error.type}] ${error.message}${statusPart}`;
}

export async function callAI(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const timeoutMs = Math.max(1, Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const retryCount = Math.max(0, Number(config.retryCount) || DEFAULT_RETRY_COUNT);
  const endpoint = `${config.baseURL.replace(/\/$/, "")}/chat/completions`;
  let lastError: AIClientError | null = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        const isRetryable = resp.status === 429 || resp.status >= 500;
        const error = new AIClientError("upstream_http", "AI request failed", {
          statusCode: resp.status,
          context: { bodySnippet: text.slice(0, 200), attempt: attempt + 1 },
        });
        if (!isRetryable) {
          throw error;
        }
        lastError = error;
        if (attempt < retryCount) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw error;
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new AIClientError("parse_error", "AI response missing content", {
          context: { hasChoices: Array.isArray(data.choices), attempt: attempt + 1 },
        });
      }
      return content;
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const normalized = isAbort
        ? new AIClientError("timeout", `AI request timed out after ${timeoutMs}ms`, { context: { attempt: attempt + 1 } })
        : toError(err);
      const retryable = normalized.type === "timeout" || normalized.type === "network" || (normalized.type === "upstream_http" && ((normalized.statusCode || 0) === 429 || (normalized.statusCode || 0) >= 500));
      lastError = normalized;
      if (retryable && attempt < retryCount) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new Error(formatErrorForDisplay(normalized));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(formatErrorForDisplay(lastError ?? new AIClientError("unknown", "AI request failed")));
}

function extractBalancedJsonCandidate(raw: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (start === -1) {
      if (ch === "{" || ch === "[") {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
      if (depth < 0) {
        start = -1;
        depth = 0;
      }
    }
  }

  return null;
}

export function parseJsonWithFallback<T>(raw: string, fallback: T): T {
  const candidates: string[] = [];

  candidates.push(raw);

  const fencedMatches = raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedMatches) {
    if (match[1]) candidates.push(match[1].trim());
  }

  const balanced = extractBalancedJsonCandidate(raw);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // continue trying the next candidate
    }
  }

  return fallback;
}
