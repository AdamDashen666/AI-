import { NextResponse } from "next/server";
import { validateReviewRequest } from "@/lib/validators";
import { reviewFixTask, reviewTask } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const validated = validateReviewRequest(await req.json());
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error, code: validated.code }, { status: 400 });
    }
    const { config, task, output, fixBrief } = validated.data;
    const review = fixBrief ? await reviewFixTask(config, task, output, fixBrief) : await reviewTask(config, task, output);
    return NextResponse.json({ review });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
