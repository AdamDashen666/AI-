import { NextResponse } from "next/server";
import JSZip from "jszip";
import { IntegrationOutput, ProjectPlan, ReviewOutput, WorkerOutput } from "@/lib/types";

type ExportFormat = "md" | "json" | "txt" | "zip";

interface ExportRequestBody {
  format: ExportFormat;
  integration: IntegrationOutput;
  plan: ProjectPlan;
  workerOutputs: WorkerOutput[];
  reviews: ReviewOutput[];
  settings?: WorkflowSettings;
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

function buildMarkdownContent(body: Omit<ExportRequestBody, "format">): string { /* unchanged */
  const { integration, plan, workerOutputs, reviews } = body;
  const workerSection = workerOutputs.map((output) => `- **Task ${output.taskId}**\n  - Result: ${output.result}\n  - Files Suggested: ${output.filesSuggested.join(", ") || "N/A"}\n  - Risks: ${output.risks.join(", ") || "N/A"}\n  - Notes: ${output.notes || "N/A"}`).join("\n");
  const reviewSection = reviews.map((review) => `- **Task ${review.taskId}**\n  - Passed: ${review.passed ? "Yes" : "No"}\n  - Score: ${review.score}\n  - Issues: ${review.issues.join(", ") || "N/A"}\n  - Suggestions: ${review.suggestions.join(", ") || "N/A"}`).join("\n");

  return ["# Workflow Result", "", "## Project Name", plan.projectName, "", "## Summary", integration.summary, "", "## Final Result", integration.finalResult, "", "## Changelog", ...(integration.changelog.length ? integration.changelog.map((item) => `- ${item}`) : ["- N/A"]), "", "## Remaining Problems", ...(integration.remainingProblems.length ? integration.remainingProblems.map((item) => `- ${item}`) : ["- N/A"]), "", "## Next Steps", ...(integration.nextSteps.length ? integration.nextSteps.map((item) => `- ${item}`) : ["- N/A"]), "", "## Worker Outputs", workerSection || "- N/A", "", "## Reviewer Feedback", reviewSection || "- N/A"].join("\n");
}

function buildTextContent(body: Omit<ExportRequestBody, "format">): string {
  return buildMarkdownContent(body).replace(/^#\s+/gm, "").replace(/^##\s+/gm, "").replace(/\*\*/g, "");
}

async function buildZipContent(body: Omit<ExportRequestBody, "format">) {
  const zip = new JSZip();
  const markdown = buildMarkdownContent(body);
  const text = buildTextContent(body);

  zip.file("final-result.md", markdown);
  zip.file("final-result.txt", text);
  zip.file("workflow-data.json", JSON.stringify(body, null, 2));
  zip.file("plan.json", JSON.stringify(body.plan, null, 2));
  zip.file("worker-outputs.json", JSON.stringify(body.workerOutputs, null, 2));
  zip.file("reviews.json", JSON.stringify(body.reviews, null, 2));

  const suggestedFolder = zip.folder("suggested-files");
  body.workerOutputs.forEach((output) => {
    const contentParts: string[] = [];
    if (output.filesSuggested.length) {
      contentParts.push("# filesSuggested", ...output.filesSuggested.map((file) => `- ${file}`));
    }
    const codeBlocks = output.result.match(/```[\s\S]*?```/g) || [];
    if (codeBlocks.length) {
      contentParts.push("", "# codeBlocks", ...codeBlocks);
    }
    if (contentParts.length) {
      suggestedFolder?.file(`task_${output.taskId}.md`, contentParts.join("\n"));
    }
  });

  return zip.generateAsync({ type: "uint8array" });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ExportRequestBody;
    const { format, integration, plan, workerOutputs, reviews } = body;

    if (!["md", "json", "txt", "zip"].includes(format)) {
      return NextResponse.json({ error: "Invalid format" }, { status: 400 });
    }

    const timestamp = getTimestampParts(new Date());
    const filenameBase = `workflow-result-${timestamp.date}-${timestamp.time}`;

    if (format === "json") {
      const fileName = `${filenameBase}.json`;
      const payload = { integration, plan, workerOutputs, reviews };
      return new NextResponse(JSON.stringify(payload, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename=\"${fileName}\"` } });
    }

    const textBody = { integration, plan, workerOutputs, reviews };
    if (format === "zip") {
      const zipData = await buildZipContent(textBody);
      return new NextResponse(zipData, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename=\"${filenameBase}.zip\"`,
        },
      });
    }

    const content = format === "md" ? buildMarkdownContent(textBody) : buildTextContent(textBody);
    const fileName = `${filenameBase}.${format}`;
    const contentType = format === "md" ? "text/markdown" : "text/plain";

    return new NextResponse(content, { headers: { "Content-Type": `${contentType}; charset=utf-8`, "Content-Disposition": `attachment; filename=\"${fileName}\"` } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
