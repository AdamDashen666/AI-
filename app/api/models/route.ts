import { NextResponse } from "next/server";
import { validateModelsRequest } from "@/lib/validators";

const summarizeResponseShape = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") {
    return `payload_type:${typeof payload}`;
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  const summary: string[] = [`keys:${keys.join(",") || "none"}`];

  if (Array.isArray(record.data)) {
    const first = record.data[0];
    const firstType = first === null ? "null" : Array.isArray(first) ? "array" : typeof first;
    const firstKeys = first && typeof first === "object" && !Array.isArray(first)
      ? Object.keys(first as Record<string, unknown>).slice(0, 8).join(",")
      : "";
    summary.push(`data_len:${record.data.length}`);
    summary.push(`data_first_type:${firstType}`);
    if (firstKeys) {
      summary.push(`data_first_keys:${firstKeys}`);
    }
  }

  if (Array.isArray(record.models)) {
    const first = record.models[0];
    const firstType = first === null ? "null" : Array.isArray(first) ? "array" : typeof first;
    summary.push(`models_len:${record.models.length}`);
    summary.push(`models_first_type:${firstType}`);
  }

  return summary.join(" | ");
};

const extractModelIds = (payload: unknown): string[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates: string[] = [];

  if (Array.isArray(record.data)) {
    for (const item of record.data) {
      if (typeof item === "string") {
        candidates.push(item);
        continue;
      }

      if (item && typeof item === "object" && "id" in item) {
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string") {
          candidates.push(id);
        }
      }
    }
  }

  if (Array.isArray(record.models)) {
    for (const item of record.models) {
      if (typeof item === "string") {
        candidates.push(item);
      }
    }
  }

  return [...new Set(candidates.map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
};

export async function POST(req: Request) {
  try {
    const validated = validateModelsRequest(await req.json());
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error, code: validated.code }, { status: 400 });
    }

    const { baseURL, apiKey } = validated.data;
    const normalizedBaseURL = baseURL.replace(/\/+$/, "");
    const resp = await fetch(`${normalizedBaseURL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const data = await resp.json().catch(() => null);
    const shapeSummary = summarizeResponseShape(data);

    if (!resp.ok) {
      console.warn(`[models API] upstream error, status=${resp.status}, shape=${shapeSummary}`);
      return NextResponse.json({ error: data?.error?.message || data?.error || `Model fetch failed: ${resp.status}` }, { status: resp.status });
    }

    const models = extractModelIds(data);

    if (models.length === 0) {
      console.warn(`[models API] successful response but no models parsed, shape=${shapeSummary}`);
      return NextResponse.json({
        error: "响应结构不兼容：请求成功但未解析到模型列表",
        code: "INVALID_REQUEST",
        models: [],
        responseShape: shapeSummary,
      }, { status: 422 });
    }

    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
