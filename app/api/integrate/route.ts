import { NextResponse } from "next/server";
import { validateIntegrateRequest } from "@/lib/validators";
import { integrateResults } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const validated = validateIntegrateRequest(await req.json());
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error, code: validated.code }, { status: 400 });
    }
    const { config, plan, workerOutputs, reviews, taskAttempts } = validated.data;
    const integration = await integrateResults(config, plan, workerOutputs, reviews, taskAttempts as any);
    return NextResponse.json({ integration });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
