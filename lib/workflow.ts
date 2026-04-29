import { callAI, parseJsonWithFallback } from "./aiClient";
import { coordinatorSystemPrompt, integratorSystemPrompt, plannerSystemPrompt, reviewerFixSystemPrompt, reviewerSystemPrompt, workerFixSystemPrompt, workerSystemPrompt } from "./prompts";
import { AIConfig, FixBrief, IntegrationOutput, PlanTask, ProjectPlan, ReviewOutput, TaskAttempt, WorkerOutput, WorkerQuota, WorkerType } from "./types";

type ChangedFile = NonNullable<WorkerOutput["changedFiles"]>[number];

function normalizeChangedFiles(value: unknown): ChangedFile[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({ path: String((item as any)?.path ?? ""), content: String((item as any)?.content ?? "") }))
      .filter((item) => item.path.trim().length > 0);
  }
  return [];
}

function migrateLegacyWorkerOutput(parsed: Record<string, unknown>, task: PlanTask): WorkerOutput {
  const legacyFullResult = parsed.fullUpdatedResult ?? parsed["full updated result"] ?? parsed.completeGameCode ?? parsed.fullGameCode ?? parsed.implementation;
  const changedFilesFromLegacy = typeof legacyFullResult === "string" && legacyFullResult.trim().length > 0
    ? [{ path: "index.html", content: legacyFullResult }]
    : [];
  const normalizedChangedFiles = normalizeChangedFiles(parsed.changedFiles);
  const hasResult = typeof parsed.result === "string" && parsed.result.trim().length > 0;
  const legacyResult = hasResult ? String(parsed.result) : JSON.stringify(parsed);
  return {
    taskId: typeof parsed.taskId === "string" && parsed.taskId.trim() ? parsed.taskId : task.id,
    result: legacyResult,
    filesSuggested: Array.isArray(parsed.filesSuggested) ? parsed.filesSuggested.map(String) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    notes: typeof parsed.notes === "string" && parsed.notes.trim().length > 0
      ? parsed.notes
      : hasResult
        ? ""
        : "legacy structured module output migrated: original payload preserved in result",
    fixedIssues: Array.isArray(parsed.fixedIssues) ? parsed.fixedIssues.map(String) : [],
    remainingRisks: Array.isArray(parsed.remainingRisks) ? parsed.remainingRisks.map(String) : [],
    changedFiles: normalizedChangedFiles.length > 0 ? normalizedChangedFiles : changedFilesFromLegacy,
  };
}

export function normalizeTask(task: Partial<PlanTask> & { taskId?: string | number; taskName?: string }, index: number): PlanTask {
  const fallbackId = `task-${String(index + 1).padStart(3, "0")}`;
  const allowedWorkerTypes: WorkerType[] = ["ui", "backend", "research", "code", "test", "integration"];
  const rawId = task.id ?? task.taskId;
  const normalizedId = typeof rawId === "number" ? String(rawId) : rawId;
  const normalizedName = typeof task.name === "string" && task.name.trim()
    ? task.name.trim()
    : typeof task.taskName === "string" && task.taskName.trim()
      ? task.taskName.trim()
      : `Task ${index + 1}`;
  const rawDescription = typeof task.description === "string" ? task.description : "";
  const rawWorkerType = typeof task.workerType === "string" ? task.workerType : "code";
  const normalizedWorkerType = allowedWorkerTypes.includes(rawWorkerType as WorkerType)
    ? (rawWorkerType as WorkerType)
    : "code";
  return {
    id: typeof normalizedId === "string" && normalizedId.trim() ? normalizedId.trim() : fallbackId,
    name: normalizedName,
    description: rawDescription || normalizedName,
    workerType: normalizedWorkerType,
    dependencies: Array.isArray(task.dependencies) ? task.dependencies.map((dep) => String(dep)) : [],
  };
}

function normalizePlannerOutput(rawPlan: unknown, fallback: ProjectPlan, maxTasks: number): ProjectPlan {
  const safeMaxTasks = Math.max(1, Math.floor(maxTasks));
  const source = (typeof rawPlan === "object" && rawPlan !== null) ? rawPlan as Record<string, unknown> : {};
  const isTopLevelArray = Array.isArray(rawPlan);
  const numericTasksFromObject = Object.keys(source)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => source[key]);
  let candidateTasks: unknown[] = [];
  if (isTopLevelArray) {
    candidateTasks = rawPlan as unknown[];
  } else if (Array.isArray(source.tasks) && source.tasks.length > 0) {
    candidateTasks = source.tasks;
  } else if (numericTasksFromObject.length > 0) {
    candidateTasks = numericTasksFromObject;
  } else if (Array.isArray(source.tasks)) {
    candidateTasks = source.tasks;
  }
  const tasks = candidateTasks.slice(0, safeMaxTasks).map((task, index) => normalizeTask((task ?? {}) as Partial<PlanTask>, index));
  const projectName = typeof source.projectName === "string" && source.projectName.trim()
    ? source.projectName.trim()
    : fallback.projectName;
  const summary = typeof source.summary === "string"
    ? source.summary
    : fallback.summary;
  return { projectName, summary, tasks };
}

export function getIntegrationBlockers(
  plan: ProjectPlan,
  outputStore: Record<string, WorkerOutput>,
  reviewStore: Record<string, ReviewOutput>,
  minimumReviewScore: number,
): string[] {
  return plan.tasks
    .map((task) => task.id)
    .filter((taskId) => {
      const output = outputStore[taskId];
      const review = reviewStore[taskId];
      if (!output || !review) return true;
      const hasIssues = Array.isArray(review.issues) && review.issues.length > 0;
      return !review.passed || Number(review.score) < minimumReviewScore || hasIssues;
    });
}

export { migrateLegacyWorkerOutput };

export async function createPlan(config: AIConfig, requirement: string, maxTasks: number, workerQuotas?: Partial<WorkerQuota>): Promise<ProjectPlan> {
  const workerTypes: WorkerType[] = ["ui", "backend", "research", "code", "test", "integration"];
  const quotaText = workerTypes
    .map((type) => `- ${type}: ${Math.max(0, Number(workerQuotas?.[type] ?? 1))}`)
    .join("\n");
  const fallback: ProjectPlan = { projectName: "Untitled Project", summary: requirement, tasks: [] };
  const raw = await callAI(
    config,
    plannerSystemPrompt,
    `Requirement:\n${requirement}\n\nConstraints:\n- Max task count: ${maxTasks}\n- Keep each task clear, independent, and executable\n- If project scope is small, you may return fewer than ${maxTasks} tasks\n- Respect the worker count limits by workerType when assigning tasks\nWorker count limits:\n${quotaText}\n\nYou MUST return a strict JSON object (NOT an array) with this exact structure:\n{\n  "projectName": "...",\n  "summary": "...",\n  "tasks": [\n    {\n      "id": "task-001",\n      "name": "Task 1",\n      "description": "...",\n      "workerType": "code",\n      "dependencies": []\n    }\n  ]\n}\n\nReturn strict JSON only.`,
  );
  const parsedPlan = parseJsonWithFallback<unknown>(raw, fallback as unknown);
  const normalizedPlan = normalizePlannerOutput(parsedPlan, fallback, maxTasks);
  if (normalizedPlan.tasks.length === 0) {
    throw new Error("计划生成失败：AI 没有返回任何任务，请重试或换模型。");
  }
  return normalizedPlan;
}

export async function runWorkerTask(config: AIConfig, task: PlanTask, requirement: string, dependencyOutputs?: Record<string, unknown>): Promise<WorkerOutput> {
  const fallback: WorkerOutput = { taskId: task.id, result: "No valid JSON output.", filesSuggested: [], risks: ["Invalid JSON"], notes: "fallback", fixedIssues: [], remainingRisks: ["Invalid JSON"], changedFiles: [] };
  const dependencyContext = dependencyOutputs && Object.keys(dependencyOutputs).length > 0
    ? JSON.stringify(dependencyOutputs, null, 2)
    : "{}";
  const raw = await callAI(config, workerSystemPrompt, `Project requirement:\n${requirement}\n\nTask:\n${JSON.stringify(task, null, 2)}\n\nDependency task outputs (read-only context, not fix-attempt previousOutput):\n${dependencyContext}\n\nReturn strict JSON only.`);
  const parsed = parseJsonWithFallback<Record<string, unknown>>(raw, fallback as unknown as Record<string, unknown>);
  return migrateLegacyWorkerOutput(parsed, task);
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

export async function createFixBrief(
  config: AIConfig,
  requirement: string,
  task: PlanTask,
  attempt: number,
  previousWorkerOutput: WorkerOutput,
  review: ReviewOutput,
): Promise<FixBrief> {
  const fallback: FixBrief = { taskId: task.id, attempt, rootCauses: ["Invalid JSON"], requiredChanges: [], forbiddenChanges: [], qualityChecklist: [], messageToWorker: "Retry with structured fixes." };
  const raw = await callAI(config, coordinatorSystemPrompt, `Original requirement:\n${requirement}\n\nTask:\n${JSON.stringify(task, null, 2)}\n\nPrevious worker output:\n${JSON.stringify(previousWorkerOutput, null, 2)}\n\nReviewer output:\n${JSON.stringify(review, null, 2)}\n\nReturn strict JSON only.`);
  const parsed = parseJsonWithFallback(raw, fallback);
  return { ...fallback, ...parsed, taskId: task.id, attempt };
}

export async function runWorkerFixTask(
  config: AIConfig,
  task: PlanTask,
  requirement: string,
  previousWorkerOutput: WorkerOutput,
  review: ReviewOutput,
  fixBrief: FixBrief,
  dependencyOutputs?: Record<string, unknown>,
): Promise<WorkerOutput> {
  const fallback: WorkerOutput = { taskId: task.id, result: "No valid JSON output.", filesSuggested: [], risks: ["Invalid JSON"], notes: "fallback", fixedIssues: [], remainingRisks: ["Invalid JSON"], changedFiles: [] };
  const dependencyContext = dependencyOutputs && Object.keys(dependencyOutputs).length > 0
    ? `\n\nDependency outputs context:\n${JSON.stringify(dependencyOutputs, null, 2)}`
    : "";
  const raw = await callAI(config, workerFixSystemPrompt, `Original requirement:\n${requirement}\n\nTask:\n${JSON.stringify(task, null, 2)}\n\nPrevious worker output:\n${JSON.stringify(previousWorkerOutput, null, 2)}\n\nReviewer feedback:\n${JSON.stringify(review, null, 2)}\n\nFixBrief:\n${JSON.stringify(fixBrief, null, 2)}${dependencyContext}\n\nReturn strict JSON only.`);
  const parsed = parseJsonWithFallback<Record<string, unknown>>(raw, fallback as unknown as Record<string, unknown>);
  return {
    ...migrateLegacyWorkerOutput(parsed, task),
    taskId: task.id,
  };
}

export async function reviewFixTask(config: AIConfig, task: PlanTask, workerOutput: WorkerOutput, fixBrief: FixBrief): Promise<ReviewOutput> {
  const fallback: ReviewOutput = { taskId: task.id, passed: false, issues: ["Invalid JSON"], suggestions: ["Retry review"], score: 0 };
  const raw = await callAI(config, reviewerFixSystemPrompt, `Task:\n${JSON.stringify(task, null, 2)}\n\nWorker output:\n${JSON.stringify(workerOutput, null, 2)}\n\nFixBrief:\n${JSON.stringify(fixBrief, null, 2)}\n\nReturn strict JSON only.`);
  const parsed = parseJsonWithFallback(raw, fallback);
  return { ...parsed, taskId: task.id, score: Number.isFinite(parsed.score) ? parsed.score : 0 };
}

export async function integrateResults(
  config: AIConfig,
  plan: ProjectPlan,
  workerOutputs: WorkerOutput[],
  reviews: ReviewOutput[],
  taskAttempts: TaskAttempt[] = [],
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
  const raw = await callAI(config, integratorSystemPrompt, `Plan:\n${JSON.stringify(plan, null, 2)}\n\nWorker outputs:\n${JSON.stringify(workerOutputs, null, 2)}\n\nReviews:\n${JSON.stringify(reviews, null, 2)}\n\nTask attempts history:\n${JSON.stringify(taskAttempts, null, 2)}\n\nReturn strict JSON only.`);
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
