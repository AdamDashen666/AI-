import { AIConfig, FixBrief, PlanTask, ProjectPlan, ReviewOutput, WorkerOutput } from "@/lib/types";

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: "INVALID_REQUEST" };

function invalid(error: string): ValidationResult<never> {
  return { ok: false, error, code: "INVALID_REQUEST" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isChangedFilesArray(value: unknown): value is Array<{ path: string; content: string }> {
  return Array.isArray(value) && value.every((item) => isObject(item) && typeof item.path === "string" && typeof item.content === "string");
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateAIConfig(value: unknown): ValidationResult<AIConfig> {
  if (!isObject(value)) return invalid("config must be an object");
  const { baseURL, apiKey, model, timeoutMs, retryCount } = value;
  if (!isNonEmptyString(baseURL) || !isValidHttpUrl(baseURL)) return invalid("config.baseURL must be a valid http/https URL");
  if (!isNonEmptyString(apiKey)) return invalid("config.apiKey must be a non-empty string");
  if (!isNonEmptyString(model)) return invalid("config.model must be a non-empty string");
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || Number.isNaN(timeoutMs) || timeoutMs < 1)) return invalid("config.timeoutMs must be a number >= 1");
  if (retryCount !== undefined && (typeof retryCount !== "number" || Number.isNaN(retryCount) || retryCount < 0)) return invalid("config.retryCount must be a number >= 0");
  return { ok: true, data: { baseURL, apiKey, model, timeoutMs: timeoutMs as number | undefined, retryCount: retryCount as number | undefined } };
}

function validatePlanTask(value: unknown, path: string): ValidationResult<PlanTask> {
  if (!isObject(value)) return invalid(`${path} must be an object`);
  const { id, name, description, workerType, dependencies } = value;
  if (!isNonEmptyString(id)) return invalid(`${path}.id must be a non-empty string`);
  if (!isNonEmptyString(name)) return invalid(`${path}.name must be a non-empty string`);
  if (typeof description !== "string") return invalid(`${path}.description must be a string`);
  if (!isNonEmptyString(workerType)) return invalid(`${path}.workerType must be a non-empty string`);
  if (!isStringArray(dependencies)) return invalid(`${path}.dependencies must be a string[]`);
  return { ok: true, data: { id, name, description, workerType: workerType as PlanTask["workerType"], dependencies } };
}

function validateWorkerOutput(value: unknown, path: string): ValidationResult<WorkerOutput> {
  if (!isObject(value)) return invalid(`${path} must be an object`);
  const { taskId, result, filesSuggested, risks, notes } = value;
  if (!isNonEmptyString(taskId)) return invalid(`${path}.taskId must be a non-empty string`);
  if (typeof result !== "string") return invalid(`${path}.result must be a string`);
  if (!isStringArray(filesSuggested)) return invalid(`${path}.filesSuggested must be a string[]`);
  if (!isStringArray(risks)) return invalid(`${path}.risks must be a string[]`);
  if (typeof notes !== "string") return invalid(`${path}.notes must be a string`);
  const changedFiles = isChangedFilesArray(value.changedFiles)
    ? value.changedFiles
    : (typeof value.fullUpdatedResult === "string" || typeof value["full updated result"] === "string" || typeof value.completeGameCode === "string" || typeof value.fullGameCode === "string" || typeof value.implementation === "string")
      ? [{ path: "index.html", content: String(value.fullUpdatedResult ?? value["full updated result"] ?? value.completeGameCode ?? value.fullGameCode ?? value.implementation ?? "") }]
      : [];
  return { ok: true, data: { taskId, result, filesSuggested, risks, notes, changedFiles } };
}

function validateReviewOutput(value: unknown, path: string): ValidationResult<ReviewOutput> {
  if (!isObject(value)) return invalid(`${path} must be an object`);
  const { taskId, passed, issues, suggestions, score } = value;
  if (!isNonEmptyString(taskId)) return invalid(`${path}.taskId must be a non-empty string`);
  if (typeof passed !== "boolean") return invalid(`${path}.passed must be a boolean`);
  if (!isStringArray(issues)) return invalid(`${path}.issues must be a string[]`);
  if (!isStringArray(suggestions)) return invalid(`${path}.suggestions must be a string[]`);
  if (typeof score !== "number" || Number.isNaN(score)) return invalid(`${path}.score must be a number`);
  return { ok: true, data: { taskId, passed, issues, suggestions, score } };
}

function validateFixBrief(value: unknown, path: string): ValidationResult<FixBrief> {
  if (!isObject(value)) return invalid(`${path} must be an object`);
  const { taskId, attempt, rootCauses, requiredChanges, forbiddenChanges, qualityChecklist, messageToWorker } = value;
  if (!isNonEmptyString(taskId)) return invalid(`${path}.taskId must be a non-empty string`);
  if (typeof attempt !== "number" || Number.isNaN(attempt)) return invalid(`${path}.attempt must be a number`);
  if (!isStringArray(rootCauses)) return invalid(`${path}.rootCauses must be a string[]`);
  if (!isStringArray(requiredChanges)) return invalid(`${path}.requiredChanges must be a string[]`);
  if (!isStringArray(forbiddenChanges)) return invalid(`${path}.forbiddenChanges must be a string[]`);
  if (!isStringArray(qualityChecklist)) return invalid(`${path}.qualityChecklist must be a string[]`);
  if (typeof messageToWorker !== "string") return invalid(`${path}.messageToWorker must be a string`);
  return { ok: true, data: { taskId, attempt, rootCauses, requiredChanges, forbiddenChanges, qualityChecklist, messageToWorker } };
}

export function validatePlanRequest(body: unknown): ValidationResult<{ config: AIConfig; requirement: string; maxTasks?: number; workerQuotas?: Record<string, number> }> {
  if (!isObject(body)) return invalid("request body must be an object");
  const config = validateAIConfig(body.config);
  if (!config.ok) return config;
  if (!isNonEmptyString(body.requirement)) return invalid("requirement must be a non-empty string");
  if (body.maxTasks !== undefined && typeof body.maxTasks !== "number") return invalid("maxTasks must be a number");
  if (body.workerQuotas !== undefined && !isObject(body.workerQuotas)) return invalid("workerQuotas must be an object");
  return { ok: true, data: { config: config.data, requirement: body.requirement, maxTasks: body.maxTasks as number | undefined, workerQuotas: body.workerQuotas as Record<string, number> | undefined } };
}

export function validateReviewRequest(body: unknown): ValidationResult<{ config: AIConfig; task: PlanTask; output: WorkerOutput; fixBrief?: FixBrief }> {
  if (!isObject(body)) return invalid("request body must be an object");
  const config = validateAIConfig(body.config); if (!config.ok) return config;
  const task = validatePlanTask(body.task, "task"); if (!task.ok) return task;
  const output = validateWorkerOutput(body.output, "output"); if (!output.ok) return output;
  if (body.fixBrief !== undefined) {
    const fixBrief = validateFixBrief(body.fixBrief, "fixBrief");
    if (!fixBrief.ok) return fixBrief;
    return { ok: true, data: { config: config.data, task: task.data, output: output.data, fixBrief: fixBrief.data } };
  }
  return { ok: true, data: { config: config.data, task: task.data, output: output.data } };
}

export function validateRunTaskRequest(body: unknown): ValidationResult<{ config: AIConfig; task: PlanTask; requirement: string; attempt?: number; previousOutput?: Record<string, unknown>; previousReview?: ReviewOutput; fixBrief?: FixBrief; dependencyOutputs?: Record<string, unknown>; previousOutputContext?: Record<string, unknown> }> {
  if (!isObject(body)) return invalid("request body must be an object");
  const config = validateAIConfig(body.config); if (!config.ok) return config;
  const task = validatePlanTask(body.task, "task"); if (!task.ok) return task;
  if (!isNonEmptyString(body.requirement)) return invalid("requirement must be a non-empty string");
  if (body.attempt !== undefined && typeof body.attempt !== "number") return invalid("attempt must be a number");
  let previousOutput: Record<string, unknown> | undefined;
  let previousReview: ReviewOutput | undefined;
  let fixBrief: FixBrief | undefined;
  let dependencyOutputs: Record<string, unknown> | undefined;
  let previousOutputContext: Record<string, unknown> | undefined;
  if (body.previousOutput === null) {
    previousOutput = {};
  } else if (body.previousOutput !== undefined) {
    if (!isObject(body.previousOutput)) return invalid("previousOutput must be an object");
    previousOutput = body.previousOutput;
  }
  if (body.dependencyOutputs !== undefined) {
    if (!isObject(body.dependencyOutputs)) return invalid("dependencyOutputs must be an object");
    dependencyOutputs = body.dependencyOutputs;
  }
  if (body.previousOutputContext !== undefined) {
    if (!isObject(body.previousOutputContext)) return invalid("previousOutputContext must be an object");
    previousOutputContext = body.previousOutputContext;
  }
  if (body.previousReview !== null && body.previousReview !== undefined) { const r = validateReviewOutput(body.previousReview, "previousReview"); if (!r.ok) return r; previousReview = r.data; }
  if (body.fixBrief !== null && body.fixBrief !== undefined) { const r = validateFixBrief(body.fixBrief, "fixBrief"); if (!r.ok) return r; fixBrief = r.data; }
  return { ok: true, data: { config: config.data, task: task.data, requirement: body.requirement, attempt: body.attempt as number | undefined, previousOutput, previousReview, fixBrief, dependencyOutputs, previousOutputContext } };
}

export function validateFixBriefRequest(body: unknown): ValidationResult<{ config: AIConfig; requirement: string; task: PlanTask; attempt: number; previousOutput: WorkerOutput; review: ReviewOutput }> {
  if (!isObject(body)) return invalid("request body must be an object");
  const config = validateAIConfig(body.config); if (!config.ok) return config;
  if (!isNonEmptyString(body.requirement)) return invalid("requirement must be a non-empty string");
  const task = validatePlanTask(body.task, "task"); if (!task.ok) return task;
  if (typeof body.attempt !== "number") return invalid("attempt must be a number");
  const previousOutput = validateWorkerOutput(body.previousOutput, "previousOutput"); if (!previousOutput.ok) return previousOutput;
  const review = validateReviewOutput(body.review, "review"); if (!review.ok) return review;
  return { ok: true, data: { config: config.data, requirement: body.requirement, task: task.data, attempt: body.attempt, previousOutput: previousOutput.data, review: review.data } };
}

export function validateIntegrateRequest(body: unknown): ValidationResult<{ config: AIConfig; plan: ProjectPlan; workerOutputs: WorkerOutput[]; reviews: ReviewOutput[]; taskAttempts?: unknown[] }> {
  if (!isObject(body)) return invalid("request body must be an object");
  const config = validateAIConfig(body.config); if (!config.ok) return config;
  if (!isObject(body.plan)) return invalid("plan must be an object");
  const plan = body.plan as unknown as ProjectPlan;
  if (!isNonEmptyString(plan.projectName) || typeof plan.summary !== "string" || !Array.isArray(plan.tasks)) return invalid("plan fields are invalid");
  for (let i = 0; i < plan.tasks.length; i += 1) {
    const taskResult = validatePlanTask(plan.tasks[i], `plan.tasks[${i}]`);
    if (!taskResult.ok) return taskResult;
  }
  if (!Array.isArray(body.workerOutputs)) return invalid("workerOutputs must be an array");
  if (!Array.isArray(body.reviews)) return invalid("reviews must be an array");
  for (let i = 0; i < body.workerOutputs.length; i += 1) { const r = validateWorkerOutput(body.workerOutputs[i], `workerOutputs[${i}]`); if (!r.ok) return r; }
  for (let i = 0; i < body.reviews.length; i += 1) { const r = validateReviewOutput(body.reviews[i], `reviews[${i}]`); if (!r.ok) return r; }
  if (body.taskAttempts !== undefined && !Array.isArray(body.taskAttempts)) return invalid("taskAttempts must be an array");
  return { ok: true, data: { config: config.data, plan, workerOutputs: body.workerOutputs as WorkerOutput[], reviews: body.reviews as ReviewOutput[], taskAttempts: body.taskAttempts as unknown[] | undefined } };
}

export function validateModelsRequest(body: unknown): ValidationResult<{ baseURL: string; apiKey: string }> {
  if (!isObject(body)) return invalid("request body must be an object");
  if (!isNonEmptyString(body.baseURL) || !isValidHttpUrl(body.baseURL)) return invalid("baseURL must be a valid http/https URL");
  if (!isNonEmptyString(body.apiKey)) return invalid("apiKey must be a non-empty string");
  return { ok: true, data: { baseURL: body.baseURL, apiKey: body.apiKey } };
}

export function validateExportRequest(body: unknown): ValidationResult<unknown> {
  if (!isObject(body)) return invalid("request body must be an object");
  if (typeof body.format !== "string") return invalid("format must be a string");
  if (!isObject(body.integration)) return invalid("integration must be an object");
  if (!isObject(body.plan)) return invalid("plan must be an object");
  if (!Array.isArray(body.workerOutputs)) return invalid("workerOutputs must be an array");
  if (!Array.isArray(body.reviews)) return invalid("reviews must be an array");
  return { ok: true, data: body };
}


export function validateCoordinatorDecisionRequest(body: unknown): ValidationResult<{ config: AIConfig; plan: ProjectPlan; workerOutputs: Record<string, WorkerOutput>; reviews: Record<string, ReviewOutput>; taskAttempts: Record<string, unknown[]>; settings: { workerRoleCounts: Record<string, number>; minimumReviewScore: number; maxReviewFixAttempts: number } }> {
  if (!isObject(body)) return invalid("request body must be an object");
  const config = validateAIConfig(body.config); if (!config.ok) return config;
  if (!isObject(body.plan)) return invalid("plan must be an object");
  const plan = body.plan as ProjectPlan;
  if (!isNonEmptyString(plan.projectName) || typeof plan.summary !== "string" || !Array.isArray(plan.tasks)) return invalid("plan fields are invalid");
  if (!isObject(body.workerOutputs)) return invalid("workerOutputs must be an object");
  if (!isObject(body.reviews)) return invalid("reviews must be an object");
  if (!isObject(body.taskAttempts)) return invalid("taskAttempts must be an object");
  if (!isObject(body.settings)) return invalid("settings must be an object");
  const settings = body.settings as Record<string, unknown>;
  if (!isObject(settings.workerRoleCounts)) return invalid("settings.workerRoleCounts must be an object");
  if (typeof settings.minimumReviewScore !== "number") return invalid("settings.minimumReviewScore must be a number");
  if (typeof settings.maxReviewFixAttempts !== "number") return invalid("settings.maxReviewFixAttempts must be a number");
  return { ok: true, data: { config: config.data, plan, workerOutputs: body.workerOutputs as Record<string, WorkerOutput>, reviews: body.reviews as Record<string, ReviewOutput>, taskAttempts: body.taskAttempts as Record<string, unknown[]>, settings: { workerRoleCounts: settings.workerRoleCounts as Record<string, number>, minimumReviewScore: settings.minimumReviewScore as number, maxReviewFixAttempts: settings.maxReviewFixAttempts as number } } };
}
