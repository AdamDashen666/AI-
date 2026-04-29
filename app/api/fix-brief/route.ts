import { NextResponse } from "next/server";
import { createFixBrief } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, requirement, task, attempt, previousOutput, review } = await req.json();
    const fixBrief = await createFixBrief(config, requirement, task, attempt, previousOutput, review);
    return NextResponse.json({ fixBrief });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
