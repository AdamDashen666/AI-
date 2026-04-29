import { NextResponse } from "next/server";

interface ModelRequestBody {
  baseURL: string;
  apiKey: string;
}

export async function POST(req: Request) {
  try {
    const { baseURL, apiKey } = (await req.json()) as ModelRequestBody;
    if (!baseURL || !apiKey) {
      return NextResponse.json({ error: "baseURL and apiKey are required" }, { status: 400 });
    }

    const normalizedBaseURL = baseURL.replace(/\/+$/, "");
    const resp = await fetch(`${normalizedBaseURL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message || data?.error || `Model fetch failed: ${resp.status}` }, { status: resp.status });
    }

    const models = Array.isArray(data?.data)
      ? data.data
          .map((item: { id?: string }) => item.id)
          .filter((id: string | undefined): id is string => Boolean(id))
      : [];

    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
