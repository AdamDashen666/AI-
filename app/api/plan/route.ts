import { NextResponse } from "next/server";
import { createPlan } from "@/lib/workflow";

export async function POST(req: Request) {
  try {
    const { config, requirement } = await req.json();
    const plan = await createPlan(config, requirement);
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
