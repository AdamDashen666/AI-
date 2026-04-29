import { NextResponse } from "next/server";
import { runWorkerTask } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, task, requirement } = await req.json();
    const output = await runWorkerTask(config, task, requirement);
    return NextResponse.json({ output });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
