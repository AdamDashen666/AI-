import { NextResponse } from "next/server";
import { validateRunTaskRequest } from "@/lib/validators";
import { runWorkerFixTask, runWorkerTask } from "@/lib/workflow";
import { WorkerOutput } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const validated = validateRunTaskRequest(await req.json());
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error, code: validated.code }, { status: 400 });
    }
    const { config, task, requirement, attempt, previousOutput, previousReview, fixBrief } = validated.data;
    const output = attempt && attempt > 1 && previousOutput && previousReview && fixBrief
      ? await runWorkerFixTask(config, task, requirement, previousOutput as unknown as WorkerOutput, previousReview, fixBrief)
      : await runWorkerTask(config, task, requirement);
    return NextResponse.json({ output });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
