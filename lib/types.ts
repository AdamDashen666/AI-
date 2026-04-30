export type WorkerType = "ui" | "backend" | "research" | "code" | "test" | "integration";

export interface AIConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retryCount?: number;
}

export interface PlanTask {
  id: string;
  name: string;
  description: string;
  workerType: WorkerType;
  dependencies: string[];
}

export interface ProjectPlan {
  projectName: string;
  summary: string;
  tasks: PlanTask[];
}

export interface WorkerOutput {
  taskId: string;
  result: string;
  filesSuggested: string[];
  risks: string[];
  notes: string;
  fixedIssues?: string[];
  remainingRisks?: string[];
  changedFiles?: Array<{
    path: string;
    content: string;
  }>;
}

export interface ReviewOutput {
  taskId: string;
  passed: boolean;
  issues: string[];
  suggestions: string[];
  score: number;
}

export interface FixBrief {
  taskId: string;
  attempt: number;
  rootCauses: string[];
  requiredChanges: string[];
  forbiddenChanges: string[];
  qualityChecklist: string[];
  messageToWorker: string;
}

export interface TaskAttempt {
  attempt: number;
  workerOutput: WorkerOutput;
  review: ReviewOutput;
  fixBrief?: FixBrief;
  passed: boolean;
}

export interface CoordinatorDecision {
  readyTaskIds: string[];
  blockedTaskIds: string[];
  retryTaskIds: string[];
  stopReason: string;
  canIntegrate: boolean;
  notes: string[];
}

export type AgentRole = "worker" | "reviewer" | "coordinator" | "user" | "system";

export interface CommunicationLogEntry {
  taskId: string;
  attempt: number;
  from: AgentRole;
  to: AgentRole;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface IntegrationOutput {
  projectName: string;
  status: "complete" | "in_progress" | "failed";
  finalResult: string;
  summary: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  changelog: string[];
  remainingProblems: string[];
  nextSteps: string[];
  testPlan: Record<string, unknown>;
}


export interface WorkflowSettings {
  retryCount: number;
  maxTasks: number;
  maxWorkers: number;
}

export type WorkerQuota = Record<WorkerType, number>;
