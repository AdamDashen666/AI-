import { NextResponse } from "next/server";
import { runCoordinatorDecision } from "@/lib/workflow";
import { validateCoordinatorDecisionRequest } from "@/lib/validators";

export async function POST(req: Request) {
  try {
    const validated = validateCoordinatorDecisionRequest(await req.json());
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error, code: validated.code }, { status: 400 });
    }
    const { config, plan, workerOutputs, reviews, taskAttempts, settings } = validated.data;
    const decision = await runCoordinatorDecision(config, plan, workerOutputs, reviews, taskAttempts, settings);
    return NextResponse.json({ decision });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
