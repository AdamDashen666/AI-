import JSZip from "jszip";
import { NextResponse } from "next/server";
import { CommunicationLogEntry, IntegrationOutput, ProjectPlan, ReviewOutput, TaskAttempt, WorkerOutput } from "@/lib/types";

type ExportFormat = "md" | "json" | "txt" | "zip";

interface ExportRequestBody {
  format: ExportFormat;
  integration: IntegrationOutput;
  plan: ProjectPlan;
  workerOutputs: WorkerOutput[];
  reviews: ReviewOutput[];
  taskAttempts: TaskAttempt[];
  communicationLog: CommunicationLogEntry[];
}

function safeList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function getTimestampParts(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());
  return { date: `${year}${month}${day}`, time: `${hour}${minute}${second}` };
}

function validateExportRequestBody(raw: unknown): { ok: true; data: ExportRequestBody } | { ok: false; error: string } {
  if (!isObject(raw)) {
    return { ok: false, error: "Invalid request body" };
  }

  const format = raw.format;
  if (format !== "md" && format !== "json" && format !== "txt" && format !== "zip") {
    return { ok: false, error: "Invalid format" };
  }

  const integration = raw.integration;
  if (!isObject(integration)) {
    return { ok: false, error: "Invalid integration payload" };
  }
  if (typeof integration.status !== "string" || typeof integration.projectName !== "string") {
    return { ok: false, error: "Integration payload missing required fields" };
  }

  const plan = raw.plan;
  if (!isObject(plan) || !Array.isArray(plan.tasks)) {
    return { ok: false, error: "Invalid plan payload" };
  }

  if (!Array.isArray(raw.workerOutputs)) {
    return { ok: false, error: "Invalid workerOutputs payload" };
  }
  if (!Array.isArray(raw.reviews)) {
    return { ok: false, error: "Invalid reviews payload" };
  }

  const taskAttempts = raw.taskAttempts;
  if (taskAttempts !== undefined && !Array.isArray(taskAttempts)) {
    return { ok: false, error: "Invalid taskAttempts payload" };
  }

  const communicationLog = raw.communicationLog;
  if (communicationLog !== undefined && !Array.isArray(communicationLog)) {
    return { ok: false, error: "Invalid communicationLog payload" };
  }

  return {
    ok: true,
    data: {
      format,
      integration: integration as unknown as IntegrationOutput,
      plan: plan as unknown as ProjectPlan,
      workerOutputs: raw.workerOutputs as WorkerOutput[],
      reviews: raw.reviews as ReviewOutput[],
      taskAttempts: (taskAttempts ?? []) as TaskAttempt[],
      communicationLog: (communicationLog ?? []) as CommunicationLogEntry[],
    },
  };
}

function buildMarkdownContent(body: Omit<ExportRequestBody, "format">): string {
  const { integration, plan, workerOutputs, reviews, taskAttempts = [] } = body;
  const workerSection = workerOutputs
    .map((output) => {
      const filesSuggested = safeList(output.filesSuggested).join(", ") || "N/A";
      const risks = safeList(output.risks).join(", ") || "N/A";
      return `- **Task ${output.taskId}**\n  - Result: ${output.result || "N/A"}\n  - Files Suggested: ${filesSuggested}\n  - Risks: ${risks}\n  - Notes: ${output.notes || "N/A"}`;
    })
    .join("\n");
  const reviewSection = reviews
    .map((review) => {
      const issues = safeList(review.issues).join(", ") || "N/A";
      const suggestions = safeList(review.suggestions).join(", ") || "N/A";
      return `- **Task ${review.taskId}**\n  - Passed: ${review.passed ? "Yes" : "No"}\n  - Score: ${review.score}\n  - Issues: ${issues}\n  - Suggestions: ${suggestions}`;
    })
    .join("\n");

  const fixBriefSection = taskAttempts
    .filter((attempt) => attempt.fixBrief)
    .map((attempt) => `- Task ${attempt.fixBrief?.taskId} / Attempt ${attempt.attempt}: ${attempt.fixBrief?.messageToWorker || "N/A"}`)
    .join("\n");
  return ["# Workflow Result", "", "## Project Name", integration.projectName || plan.projectName || "N/A", "", "## Status", integration.status || "in_progress", "", "## Summary", integration.summary || "N/A", "", "## Final Result", integration.finalResult || "N/A", "", "## Final Task Statuses", ...(plan.tasks.map((task) => `- ${task.id}: ${reviews.find((review) => review.taskId === task.id)?.passed ? "passed" : "failed"}`)), "", "## Changelog", ...(safeList(integration.changelog).length ? safeList(integration.changelog).map((item) => `- ${item}`) : ["- N/A"]), "", "## Remaining Problems", ...(safeList(integration.remainingProblems).length ? safeList(integration.remainingProblems).map((item) => `- ${item}`) : ["- N/A"]), "", "## Next Steps", ...(safeList(integration.nextSteps).length ? safeList(integration.nextSteps).map((item) => `- ${item}`) : ["- N/A"]), "", "## Worker Outputs", workerSection || "- N/A", "", "## Reviewer Feedback Summary", reviewSection || "- N/A", "", "## Coordinator Fix Briefs", fixBriefSection || "- N/A"].join("\n");
}

function buildTextContent(body: Omit<ExportRequestBody, "format">): string {
  return buildMarkdownContent(body).replace(/^#\s+/gm, "").replace(/^##\s+/gm, "").replace(/\*\*/g, "");
}

export async function POST(req: Request) {
  try {
    const rawBody: unknown = await req.json();
    const validated = validateExportRequestBody(rawBody);

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { format, integration, plan, workerOutputs, reviews, taskAttempts, communicationLog } = validated.data;

    if (integration.status !== "complete") {
      return NextResponse.json({ error: "Integration is not complete. Export is blocked." }, { status: 400 });
    }

    const timestamp = getTimestampParts(new Date());
    const filenameBase = `workflow-result-${timestamp.date}-${timestamp.time}`;

    if (format === "json") {
      const fileName = `${filenameBase}.json`;
      const payload = { integration, plan, workerOutputs, reviews, taskAttempts, communicationLog };
      return new NextResponse(JSON.stringify(payload, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename=\"${fileName}\"` } });
    }

    const textBody = { integration, plan, workerOutputs, reviews, taskAttempts, communicationLog };
    const markdownContent = buildMarkdownContent(textBody);
    const txtContent = buildTextContent(textBody);

    if (format === "zip") {
      const zip = new JSZip();
      (integration.files || []).forEach((file: { path?: string; content?: string }) => {
        if (file?.path?.trim()) {
          zip.file(file.path, file.content ?? "");
        }
      });
      zip.file("README.md", markdownContent);
      zip.file("workflow-data.json", JSON.stringify({ integration, plan, workerOutputs, reviews, taskAttempts, communicationLog }, null, 2));
      zip.file(`${filenameBase}.md`, markdownContent);
      zip.file(`${filenameBase}.txt`, txtContent);
      zip.file(`${filenameBase}.json`, JSON.stringify({ integration, plan, workerOutputs, reviews, taskAttempts, communicationLog }, null, 2));
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      return new NextResponse(zipBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename=\"${filenameBase}.zip\"`,
        },
      });
    }

    const content = format === "md" ? markdownContent : txtContent;
    const fileName = `${filenameBase}.${format}`;
    const contentType = format === "md" ? "text/markdown" : "text/plain";

    return new NextResponse(content, { headers: { "Content-Type": `${contentType}; charset=utf-8`, "Content-Disposition": `attachment; filename=\"${fileName}\"` } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
