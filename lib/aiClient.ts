import { AIConfig } from "./types";

export async function callAI(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const resp = await fetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
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
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI request failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response missing content");
  return content;
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
