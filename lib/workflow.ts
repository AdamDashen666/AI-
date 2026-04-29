import { callAI, parseJsonWithFallback } from "./aiClient";
import { integratorSystemPrompt, plannerSystemPrompt, reviewerSystemPrompt, workerSystemPrompt } from "./prompts";
import { AIConfig, IntegrationOutput, PlanTask, ProjectPlan, ReviewOutput, WorkerOutput } from "./types";

function normalizeTask(task: Partial<PlanTask>, index: number): PlanTask {
  const fallbackId = `task_${index + 1}`;
  return {
    id: typeof task.id === "string" && task.id.trim() ? task.id.trim() : fallbackId,
    name: typeof task.name === "string" && task.name.trim() ? task.name.trim() : `Task ${index + 1}`,
    description: typeof task.description === "string" ? task.description : "",
    workerType: (task.workerType ?? "code") as PlanTask["workerType"],
    dependencies: Array.isArray(task.dependencies) ? task.dependencies.map((dep) => String(dep)) : [],
  };
}

export async function createPlan(config: AIConfig, requirement: string, maxTasks: number): Promise<ProjectPlan> {
  const fallback: ProjectPlan = { projectName: "Untitled Project", summary: requirement, tasks: [] };
  const raw = await callAI(
    config,
    plannerSystemPrompt,
    `Requirement:\n${requirement}\n\nConstraints:\n- Max task count: ${maxTasks}\n- Keep each task clear, independent, and executable\n- If project scope is small, you may return fewer than ${maxTasks} tasks\n\nReturn strict JSON only.`,
  );
  const plan = parseJsonWithFallback(raw, fallback);
  const rawTasks = Array.isArray(plan.tasks) ? plan.tasks.slice(0, maxTasks) : [];
  const tasks = rawTasks.map((task, index) => normalizeTask(task, index));
  return { ...plan, tasks };
}

export async function runWorkerTask(config: AIConfig, task: PlanTask, requirement: string): Promise<WorkerOutput> {
  const fallback: WorkerOutput = { taskId: task.id, result: "No valid JSON output.", filesSuggested: [], risks: ["Invalid JSON"], notes: "fallback" };
  const raw = await callAI(config, workerSystemPrompt, `Project requirement:\n${requirement}\n\nTask:\n${JSON.stringify(task, null, 2)}\n\nReturn strict JSON only.`);
  const parsed = parseJsonWithFallback(raw, fallback);
  return { ...parsed, taskId: typeof parsed.taskId === "string" && parsed.taskId.trim() ? parsed.taskId : task.id };
}

export async function reviewTask(config: AIConfig, task: PlanTask, workerOutput: WorkerOutput): Promise<ReviewOutput> {
  const fallback: ReviewOutput = { taskId: task.id, passed: false, issues: ["Invalid JSON"], suggestions: ["Retry review"], score: 0 };
  const raw = await callAI(config, reviewerSystemPrompt, `Task:\n${JSON.stringify(task, null, 2)}\n\nWorker output:\n${JSON.stringify(workerOutput, null, 2)}\n\nReturn strict JSON only.`);
  const parsed = parseJsonWithFallback(raw, fallback);
  return {
    ...parsed,
    taskId: typeof parsed.taskId === "string" && parsed.taskId.trim() ? parsed.taskId : task.id,
    score: Number.isFinite(parsed.score) ? parsed.score : 0,
  };
}

export async function integrateResults(
  config: AIConfig,
  plan: ProjectPlan,
  workerOutputs: WorkerOutput[],
  reviews: ReviewOutput[],
): Promise<IntegrationOutput> {
  const hasAllWorkers = plan.tasks.every((task) => workerOutputs.some((output) => output.taskId === task.id));
  const hasAllReviews = plan.tasks.every((task) => reviews.some((review) => review.taskId === task.id));
  const fallbackStatus: IntegrationOutput["status"] = hasAllWorkers && hasAllReviews ? "complete" : "in_progress";
  const fallback: IntegrationOutput = {
    projectName: plan.projectName,
    status: fallbackStatus,
    finalResult: "Integration fallback",
    summary: "Invalid JSON",
    files: [],
    changelog: [],
    remainingProblems: ["Invalid JSON"],
    nextSteps: [],
    testPlan: {},
  };
  const raw = await callAI(config, integratorSystemPrompt, `Plan:\n${JSON.stringify(plan, null, 2)}\n\nWorker outputs:\n${JSON.stringify(workerOutputs, null, 2)}\n\nReviews:\n${JSON.stringify(reviews, null, 2)}\n\nReturn strict JSON only.`);
  const parsed = parseJsonWithFallback(raw, fallback);
  const normalizedFiles = Array.isArray(parsed.files)
    ? parsed.files
        .map((file) => ({ path: String(file?.path ?? ""), content: String(file?.content ?? "") }))
        .filter((file) => file.path.trim().length > 0)
    : [];
  const allCovered = hasAllWorkers && hasAllReviews;
  const status = parsed.status === "failed" ? "failed" : allCovered ? parsed.status ?? "complete" : "in_progress";

  return {
    projectName: typeof parsed.projectName === "string" && parsed.projectName.trim() ? parsed.projectName : plan.projectName,
    status: status === "complete" && !allCovered ? "in_progress" : status,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    finalResult: typeof parsed.finalResult === "string" ? parsed.finalResult : "",
    files: normalizedFiles,
    changelog: Array.isArray(parsed.changelog) ? parsed.changelog.map(String) : [],
    remainingProblems: Array.isArray(parsed.remainingProblems) ? parsed.remainingProblems.map(String) : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [],
    testPlan: typeof parsed.testPlan === "object" && parsed.testPlan !== null ? parsed.testPlan : {},
  };
}
