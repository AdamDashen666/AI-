export type WorkerType = "ui" | "backend" | "research" | "code" | "test" | "integration";

export interface AIConfig {
  baseURL: string;
  apiKey: string;
  model: string;
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
}

export interface ReviewOutput {
  taskId: string;
  passed: boolean;
  issues: string[];
  suggestions: string[];
  score: number;
}

export interface IntegrationOutput {
  finalResult: string;
  summary: string;
  changelog: string[];
  remainingProblems: string[];
  nextSteps: string[];
}


export interface WorkflowSettings {
  retryCount: number;
  maxTasks: number;
  maxWorkers: number;
}
