import { NextResponse } from "next/server";
import { reviewTask } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, task, output } = await req.json();
    const review = await reviewTask(config, task, output);
    return NextResponse.json({ review });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
