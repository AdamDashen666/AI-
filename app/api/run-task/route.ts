import { NextResponse } from "next/server";
import { runWorkerFixTask, runWorkerTask } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, task, requirement, attempt, previousOutput, previousReview, fixBrief } = await req.json();
    const output = attempt > 1 && previousOutput && previousReview && fixBrief
      ? await runWorkerFixTask(config, task, requirement, previousOutput, previousReview, fixBrief)
      : await runWorkerTask(config, task, requirement);
    return NextResponse.json({ output });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
