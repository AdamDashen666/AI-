import { callAI, parseJsonWithFallback } from "./aiClient";
import { integratorSystemPrompt, plannerSystemPrompt, reviewerSystemPrompt, workerSystemPrompt } from "./prompts";
import { AIConfig, IntegrationOutput, PlanTask, ProjectPlan, ReviewOutput, WorkerOutput } from "./types";

export async function createPlan(config: AIConfig, requirement: string, maxTasks: number): Promise<ProjectPlan> {
  const fallback: ProjectPlan = { projectName: "Untitled Project", summary: requirement, tasks: [] };
  const raw = await callAI(
    config,
    plannerSystemPrompt,
    `Requirement:\n${requirement}\n\nConstraints:\n- Max task count: ${maxTasks}\n- Keep each task clear, independent, and executable\n- If project scope is small, you may return fewer than ${maxTasks} tasks\n\nReturn strict JSON only.`,
  );
  const plan = parseJsonWithFallback(raw, fallback);
  return { ...plan, tasks: Array.isArray(plan.tasks) ? plan.tasks.slice(0, maxTasks) : [] };
}

export async function runWorkerTask(config: AIConfig, task: PlanTask, requirement: string): Promise<WorkerOutput> {
  const fallback: WorkerOutput = { taskId: task.id, result: "No valid JSON output.", filesSuggested: [], risks: ["Invalid JSON"], notes: "fallback" };
  const raw = await callAI(config, workerSystemPrompt, `Project requirement:\n${requirement}\n\nTask:\n${JSON.stringify(task, null, 2)}\n\nReturn strict JSON only.`);
  return parseJsonWithFallback(raw, fallback);
}

export async function reviewTask(config: AIConfig, task: PlanTask, workerOutput: WorkerOutput): Promise<ReviewOutput> {
  const fallback: ReviewOutput = { taskId: task.id, passed: false, issues: ["Invalid JSON"], suggestions: ["Retry review"], score: 0 };
  const raw = await callAI(config, reviewerSystemPrompt, `Task:\n${JSON.stringify(task, null, 2)}\n\nWorker output:\n${JSON.stringify(workerOutput, null, 2)}\n\nReturn strict JSON only.`);
  return parseJsonWithFallback(raw, fallback);
}

export async function integrateResults(
  config: AIConfig,
  plan: ProjectPlan,
  workerOutputs: WorkerOutput[],
  reviews: ReviewOutput[],
): Promise<IntegrationOutput> {
  const fallback: IntegrationOutput = { finalResult: "Integration fallback", summary: "Invalid JSON", changelog: [], remainingProblems: ["Invalid JSON"], nextSteps: [] };
  const raw = await callAI(config, integratorSystemPrompt, `Plan:\n${JSON.stringify(plan, null, 2)}\n\nWorker outputs:\n${JSON.stringify(workerOutputs, null, 2)}\n\nReviews:\n${JSON.stringify(reviews, null, 2)}\n\nReturn strict JSON only.`);
  return parseJsonWithFallback(raw, fallback);
}
