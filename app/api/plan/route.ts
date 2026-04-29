import { NextResponse } from "next/server";
import { validatePlanRequest } from "@/lib/validators";
import { createPlan } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const validated = validatePlanRequest(await req.json());
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error, code: validated.code }, { status: 400 });
    }
    const { config, requirement, maxTasks, workerQuotas } = validated.data;
    const normalizedMaxTasks = Math.min(50, Math.max(1, Number(maxTasks) || 5));
    const plan = await createPlan(config, requirement, normalizedMaxTasks, workerQuotas);
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
