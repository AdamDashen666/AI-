import { NextResponse } from "next/server";
import { createPlan } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, requirement, maxTasks, workerQuotas } = await req.json();
    const normalizedMaxTasks = Math.min(50, Math.max(1, Number(maxTasks) || 5));
    const plan = await createPlan(config, requirement, normalizedMaxTasks, workerQuotas);
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
