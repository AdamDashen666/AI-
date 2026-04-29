import { NextResponse } from "next/server";
import { integrateResults } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, plan, workerOutputs, reviews } = await req.json();
    const integration = await integrateResults(config, plan, workerOutputs, reviews);
    return NextResponse.json({ integration });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
