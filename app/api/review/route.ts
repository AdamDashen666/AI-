import { NextResponse } from "next/server";
import { reviewFixTask, reviewTask } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, task, output, fixBrief } = await req.json();
    const review = fixBrief ? await reviewFixTask(config, task, output, fixBrief) : await reviewTask(config, task, output);
    return NextResponse.json({ review });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
