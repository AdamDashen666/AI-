import { NextResponse } from "next/server";
import { validateFixBriefRequest } from "@/lib/validators";
import { createFixBrief } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const validated = validateFixBriefRequest(await req.json());
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error, code: validated.code }, { status: 400 });
    }
    const { config, requirement, task, attempt, previousOutput, review } = validated.data;
    const fixBrief = await createFixBrief(config, requirement, task, attempt, previousOutput, review);
    return NextResponse.json({ fixBrief });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
