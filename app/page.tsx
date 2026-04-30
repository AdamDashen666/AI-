"use client";

import { useMemo, useState } from "react";
import { AIConfig, CommunicationLogEntry, FixBrief, IntegrationOutput, ProjectPlan, ReviewOutput, TaskAttempt, WorkerOutput } from "@/lib/types";
import { getIntegrationBlockers, isReviewPassed } from "@/lib/workflow";

type TaskStatus = "idle" | "waiting_dependencies" | "done" | "passed" | "failed" | "blocked";
type ProgressPhase = "idle" | "planning" | "planned" | "running" | "integrating" | "done" | "failed" | "blocked";
type ExportFormat = "md" | "json" | "txt" | "zip";
type AppLogLevel = "info" | "warn" | "error";
type AppLogEntry = { timestamp: string; level: AppLogLevel; message: string; detail?: unknown };
type WorkflowErrorDetail = { stage: "parseWorkerOutput" | "validateSchema" | "startTask" | "reviewTask" | "finalAssembly"; taskId: string; attempt: number; schemaName: string; rawValue: string; errorMessage: string; stack: string };
type AutoMatchComplexity = "simple" | "medium" | "complex";
type AutoMatchResult = { complexity: AutoMatchComplexity; workerRoleCounts: Record<string, number>; maxConcurrentWorkers: number; maxTasks: number; reason: string };

function getFriendlyErrorMessage(rawMessage: string): string {
  const match = rawMessage.match(/^\[(timeout|upstream_http|parse_error|network|unknown)\]\s*(.*)$/);
  if (!match) return rawMessage;
  const [, type, detail] = match;
  if (type === "timeout") return `请求超时，请稍后重试。${detail ? `（${detail}）` : ""}`;
  if (type === "upstream_http") return `上游 AI 服务返回错误，请稍后重试或检查配置。${detail ? `（${detail}）` : ""}`;
  if (type === "parse_error") return `AI 返回内容格式异常，请重试。${detail ? `（${detail}）` : ""}`;
  if (type === "network") return `网络连接异常，请检查网络后重试。${detail ? `（${detail}）` : ""}`;
  return `请求失败，请稍后重试。${detail ? `（${detail}）` : ""}`;
}

function normalizeTaskKey(taskId: unknown): string {
  return String(taskId ?? "").trim();
}

function normalizePreviousOutput(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export default function HomePage() {
  const [config, setConfig] = useState<AIConfig>({ baseURL: "https://api.openai.com/v1", apiKey: "", model: "" });
  const [requirement, setRequirement] = useState("");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [workerOutputs, setWorkerOutputs] = useState<Record<string, WorkerOutput>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewOutput>>({});
  const [integration, setIntegration] = useState<IntegrationOutput | null>(null);
  const [taskAttempts, setTaskAttempts] = useState<Record<string, TaskAttempt[]>>({});
  const [communicationLog, setCommunicationLog] = useState<CommunicationLogEntry[]>([]);
  const [loading, setLoading] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<string>("");
  const [maxConcurrentWorkers, setMaxConcurrentWorkers] = useState<number>(1);
  const [minimumReviewScore, setMinimumReviewScore] = useState<number>(80);
  const [workerRoleCounts, setWorkerRoleCounts] = useState<Record<string, number>>({
    ui: 1,
    backend: 0,
    research: 0,
    code: 1,
    test: 1,
    integration: 1,
  });
  const [autoMatchWorkerCounts, setAutoMatchWorkerCounts] = useState<boolean>(true);
  const [autoMatchSummary, setAutoMatchSummary] = useState<string>("");
  const [useCustomWorkerModel, setUseCustomWorkerModel] = useState<boolean>(false);
  const [customWorkerModel, setCustomWorkerModel] = useState<string>("");
  const [progress, setProgress] = useState<{ total: number; done: number; phase: ProgressPhase }>({ total: 0, done: 0, phase: "idle" });
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([]);

  const taskStatus = useMemo(() => {
    const map: Record<string, TaskStatus> = {};
    const reviewedTaskIds = new Set(Object.keys(reviews));
    plan?.tasks.forEach((t) => {
      const taskKey = normalizeTaskKey(t.id);
      const dependencies = Array.isArray(t.dependencies) ? t.dependencies.map((dep) => normalizeTaskKey(dep)) : [];
      const missingDeps = dependencies.some((dep) => !reviewedTaskIds.has(dep));
      const failedDeps = dependencies.some((dep) => reviews[dep] && !isReviewPassed(reviews[dep], minimumReviewScore));
      if (failedDeps) {
        map[taskKey] = "blocked";
      } else if (reviews[taskKey]) {
        map[taskKey] = isReviewPassed(reviews[taskKey], minimumReviewScore) ? "passed" : "failed";
      } else if (workerOutputs[taskKey]) {
        map[taskKey] = "done";
      } else if (missingDeps) {
        map[taskKey] = "waiting_dependencies";
      } else {
        map[taskKey] = "idle";
      }
    });
    return map;
  }, [plan, workerOutputs, reviews, taskAttempts, minimumReviewScore]);

  const progressPercent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const missingTasks = useMemo(() => {
    if (!plan) return [];
    return plan.tasks
      .map((task) => ({ key: normalizeTaskKey(task.id), label: String(task.id) }))
      .filter((task) => !workerOutputs[task.key] || !reviews[task.key])
      .map((task) => task.label);
  }, [plan, workerOutputs, reviews]);


  function appendLog(level: AppLogLevel, message: string, detail?: unknown) {
    setAppLogs((prev) => [...prev, { timestamp: new Date().toISOString(), level, message, detail }]);
  }

  function appendCommunicationLog(entry: CommunicationLogEntry) {
    setCommunicationLog((prev) => [...prev, entry]);
  }

  function analyzeComplexity(req: string): AutoMatchResult {
    const normalized = req.toLowerCase();
    const lengthScore = req.length;
    const keywordHits = ["backend", "database", "login", "api", "auth", "upload", "payment", "admin", "dashboard", "agent", "workflow", "deploy", "deployment", "test", "documentation", "full stack", "fullstack"].filter((k) => normalized.includes(k));
    const strongHits = ["database", "payment", "admin", "agent", "workflow", "multi", "permission", "auth"].filter((k) => normalized.includes(k)).length;
    let complexity: AutoMatchComplexity = "simple";
    if (lengthScore > 800 || keywordHits.length >= 6 || strongHits >= 3) complexity = "complex";
    else if (lengthScore > 250 || keywordHits.length >= 2) complexity = "medium";

    if (complexity === "simple") return { complexity, workerRoleCounts: { ui: 1, backend: 0, research: 0, code: 1, test: 1, integration: 1 }, maxConcurrentWorkers: 1, maxTasks: 4, reason: `需求较短，关键词较少（${keywordHits.join(", ") || "无"}）。` };
    if (complexity === "medium") return { complexity, workerRoleCounts: { ui: 1, backend: 1, research: 1, code: 2, test: 1, integration: 1 }, maxConcurrentWorkers: 2, maxTasks: 6, reason: `检测到中等复杂度关键词：${keywordHits.join(", ") || "无"}。` };
    return { complexity, workerRoleCounts: { ui: 2, backend: 2, research: 1, code: 3, test: 2, integration: 1 }, maxConcurrentWorkers: 3, maxTasks: 10, reason: `检测到高复杂度需求，关键词：${keywordHits.join(", ") || "无"}。` };
  }

  function downloadDiagnosticLog() {
    const payload = { generatedAt: new Date().toISOString(), requirement, config: { ...config, apiKey: config.apiKey ? "***masked***" : "" }, settings: { maxConcurrentWorkers, minimumReviewScore, workerRoleCounts, useCustomWorkerModel, customWorkerModel }, progress, errorMessage, communicationLog, appLogs, plan, workerOutputs, reviews, integration, taskAttempts };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-diagnostic-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    appendLog("info", "用户下载诊断日志");
  }

  async function refreshModels() {
    setModelStatus("正在刷新模型...");
    appendLog("info", "开始刷新模型列表");
    setErrorMessage("");
    try {
      const resp = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseURL: config.baseURL, apiKey: config.apiKey }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `刷新失败: ${resp.status}`);
      const modelIds = Array.isArray(data.models) ? data.models : [];
      setModels(modelIds);
      if (modelIds.length > 0 && !modelIds.includes(config.model)) {
        setConfig({ ...config, model: modelIds[0] });
      }
      setModelStatus("刷新成功");
      appendLog("info", "模型列表刷新成功", { count: modelIds.length });
    } catch (error) {
      setModelStatus(`刷新失败：${(error as Error).message}`);
      setErrorMessage((error as Error).message);
      appendLog("error", "模型列表刷新失败", (error as Error).message);
    }
  }

  async function executeOneTask(
    task: ProjectPlan["tasks"][number],
    activeConfig: AIConfig,
    outputStore: Record<string, WorkerOutput>,
    reviewStore: Record<string, ReviewOutput>,
    dependencyOutputMap: Record<string, WorkerOutput>,
  ): Promise<TaskAttempt[]> {
    const taskKey = normalizeTaskKey(task.id);
    const maxReviewFixAttempts = 3;
    const attempts: TaskAttempt[] = [];
    let currentOutput: WorkerOutput | null = null;
    let currentReview: ReviewOutput | null = null;
    let latestFixBrief: FixBrief | undefined;

    for (let attempt = 1; attempt <= maxReviewFixAttempts; attempt += 1) {
      try {
        appendLog("info", `任务 ${taskKey} 开始 attempt ${attempt}/${maxReviewFixAttempts}`);
        const previousOutputPayload = attempt > 1
          ? normalizePreviousOutput(currentOutput)
          : {};
        const dependencyOutputsPayload = normalizePreviousOutput(dependencyOutputMap);
        appendCommunicationLog({ taskId: taskKey, attempt, from: "system", to: "worker", timestamp: new Date().toISOString(), payload: { previousOutput: previousOutputPayload, dependencyOutputs: dependencyOutputsPayload, previousReview: attempt > 1 ? currentReview : undefined, fixBrief: attempt > 1 ? latestFixBrief : undefined } });
        const runTaskBody = {
          config: activeConfig,
          task,
          requirement,
          attempt,
          dependencyOutputs: dependencyOutputsPayload,
          previousOutput: previousOutputPayload,
          ...(attempt > 1 && currentReview ? { previousReview: currentReview } : {}),
          ...(attempt > 1 && latestFixBrief ? { fixBrief: latestFixBrief } : {}),
        };
        const runResp: Response = await fetch("/api/run-task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(runTaskBody) });
        const runData: { output?: WorkerOutput; error?: string } = await runResp.json().catch(() => ({}));
        if (!runResp.ok || !runData.output) throw new Error(runData.error || `任务执行失败: ${runResp.status}`);
        currentOutput = runData.output;
        appendCommunicationLog({ taskId: taskKey, attempt, from: "worker", to: "reviewer", timestamp: new Date().toISOString(), payload: currentOutput as unknown as Record<string, unknown> });

        const reviewResp: Response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, task, output: currentOutput, fixBrief: latestFixBrief }) });
        const reviewData: { review?: ReviewOutput; error?: string } = await reviewResp.json().catch(() => ({}));
        if (!reviewResp.ok || !reviewData.review) throw new Error(reviewData.error || `评审失败: ${reviewResp.status}`);
        currentReview = {
          ...reviewData.review,
          score: (() => { const rawScore = Number(reviewData.review.score); return Number.isFinite(rawScore) ? rawScore : 0; })(),
          issues: Array.isArray(reviewData.review.issues) ? reviewData.review.issues : [],
          suggestions: Array.isArray(reviewData.review.suggestions) ? reviewData.review.suggestions : [],
        };
        if (typeof currentReview.passed !== "boolean") {
          currentReview.passed = currentReview.score >= minimumReviewScore;
        }

        const passedByScore = Number(currentReview.score) >= minimumReviewScore;
        if (!passedByScore) {
          currentReview = {
            ...currentReview,
            passed: false,
            issues: [...(currentReview.issues || []), `评分 ${currentReview.score} 低于用户设置的最低分 ${minimumReviewScore}`],
            suggestions: [...(currentReview.suggestions || []), "请针对问题逐条修复，并提高正确性、完整性和可维护性。"],
          };
        }
        const isPassed = isReviewPassed(currentReview, minimumReviewScore);
        currentReview = { ...currentReview, passed: isPassed };
        appendCommunicationLog({ taskId: taskKey, attempt, from: "reviewer", to: isPassed ? "worker" : "coordinator", timestamp: new Date().toISOString(), payload: currentReview as unknown as Record<string, unknown> });

        appendLog("info", `任务 ${taskKey} attempt ${attempt} 评审分数 ${Number(currentReview.score)}，阈值 ${minimumReviewScore}，通过=${isPassed}`);
        const attemptItem: TaskAttempt = { attempt, workerOutput: currentOutput, review: currentReview, passed: isPassed };
        if (isPassed) {
          attempts.push(attemptItem);
          appendLog("info", `任务 ${taskKey} 在 attempt ${attempt} 评审通过`);
          break;
        }

        if (attempt >= maxReviewFixAttempts) {
          attempts.push(attemptItem);
          appendLog("error", `任务 ${taskKey} 已达到最大重试次数 ${maxReviewFixAttempts}，标记失败`);
          break;
        }

        const coordinatorResp = await fetch("/api/fix-brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, requirement, task, attempt, previousOutput: currentOutput, review: currentReview }) });
        const coordinatorData = await coordinatorResp.json().catch(() => ({}));
        if (!coordinatorResp.ok || !coordinatorData.fixBrief) throw new Error(coordinatorData.error || `协调失败: ${coordinatorResp.status}`);
        latestFixBrief = coordinatorData.fixBrief as FixBrief;
        attemptItem.fixBrief = latestFixBrief;
        appendCommunicationLog({ taskId: taskKey, attempt, from: "coordinator", to: "worker", timestamp: new Date().toISOString(), payload: latestFixBrief as unknown as Record<string, unknown> });
        attempts.push(attemptItem);
      } catch (error) {
        const message = (error as Error).message || "未知错误";
        currentOutput = {
          taskId: taskKey,
          result: `任务失败：${message}`,
          filesSuggested: currentOutput?.filesSuggested || [],
          risks: [...(currentOutput?.risks || []), message],
          notes: `Attempt ${attempt} 失败，将进入重试流程。`,
          fixedIssues: currentOutput?.fixedIssues || [],
          remainingRisks: [...(currentOutput?.remainingRisks || []), message],
          changedFiles: currentOutput?.changedFiles || [],
        };
        currentReview = {
          taskId: taskKey,
          passed: false,
          issues: [...(currentReview?.issues || []), message],
          suggestions: [...(currentReview?.suggestions || []), "请根据失败原因修复后重试，特别关注超时与输出格式。"],
          score: Number(currentReview?.score ?? 0),
        };
        const attemptItem: TaskAttempt = { attempt, workerOutput: currentOutput, review: currentReview, passed: false };
        attempts.push(attemptItem);
        appendCommunicationLog({ taskId: taskKey, attempt, from: "worker", to: "reviewer", timestamp: new Date().toISOString(), payload: currentOutput as unknown as Record<string, unknown> });
        appendCommunicationLog({ taskId: taskKey, attempt, from: "reviewer", to: attempt < maxReviewFixAttempts ? "coordinator" : "worker", timestamp: new Date().toISOString(), payload: currentReview as unknown as Record<string, unknown> });
        const isTimeoutLike = /\[(timeout|network|upstream_http)\]/.test(message) || /timed out/i.test(message);
        if (isTimeoutLike) {
          const willRetry = attempt < maxReviewFixAttempts;
          appendLog(willRetry ? "warn" : "error", `任务 ${taskKey} AI 请求异常（可重试）`, { taskId: taskKey, attempt, retryIndex: attempt - 1, timeoutMs: 120000, willRetry, message });
          appendCommunicationLog({ taskId: taskKey, attempt, from: "system", to: "worker", timestamp: new Date().toISOString(), payload: { event: "ai_request_retry", taskId: taskKey, attempt, retryIndex: attempt - 1, timeoutMs: 120000, willRetry, error: message } });
        }
        appendLog("error", `任务 ${taskKey} attempt ${attempt} 失败`, {
          stage: message.includes("评审") ? "reviewTask" : "startTask",
          taskId: taskKey,
          attempt,
          schemaName: "WorkerOutput/ReviewOutput",
          rawValue: message,
          errorMessage: message,
          stack: (error as Error).stack || "",
        });

        if (attempt >= maxReviewFixAttempts) {
          appendLog("error", `任务 ${taskKey} 在 ${maxReviewFixAttempts} 次尝试后仍失败`);
          break;
        }

        const coordinatorResp = await fetch("/api/fix-brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, requirement, task, attempt, previousOutput: currentOutput, review: currentReview }) });
        const coordinatorData = await coordinatorResp.json().catch(() => ({}));
        if (coordinatorResp.ok && coordinatorData.fixBrief) {
          latestFixBrief = coordinatorData.fixBrief as FixBrief;
          attempts[attempts.length - 1].fixBrief = latestFixBrief;
          appendCommunicationLog({ taskId: taskKey, attempt, from: "coordinator", to: "worker", timestamp: new Date().toISOString(), payload: latestFixBrief as unknown as Record<string, unknown> });
        }
      }
    }

    if (!currentOutput || !currentReview) throw new Error(`任务 ${taskKey} 没有产生有效结果`);
    outputStore[taskKey] = currentOutput;
    reviewStore[taskKey] = currentReview;
    setWorkerOutputs((prev) => ({ ...prev, [taskKey]: currentOutput }));
    setReviews((prev) => ({ ...prev, [taskKey]: currentReview }));
    setTaskAttempts((prev) => ({ ...prev, [taskKey]: attempts }));
    return attempts;
  }


  async function executeTasksAndIntegrate(currentPlan: ProjectPlan) {
    setLoading("running tasks");
    const activeConfig = useCustomWorkerModel && customWorkerModel.trim() ? { ...config, model: customWorkerModel.trim() } : config;
    const concurrency = Math.max(1, Math.floor((currentPlan as ProjectPlan & { __effectiveMaxConcurrentWorkers?: number }).__effectiveMaxConcurrentWorkers ?? maxConcurrentWorkers));
    const selectedTasks = currentPlan.tasks;
    const outputStore: Record<string, WorkerOutput> = {};
    const reviewStore: Record<string, ReviewOutput> = {};
    const allAttempts: TaskAttempt[] = [];
    const maxReviewFixAttempts = 3;
    setProgress({ total: selectedTasks.length + 1, done: 0, phase: "running" });

    try {
      const taskMap = new Map(selectedTasks.map((task) => [normalizeTaskKey(task.id), task]));
      const dependencyMap = new Map<string, string[]>();
      for (const task of selectedTasks) {
        const taskKey = normalizeTaskKey(task.id);
        const deps = Array.isArray(task.dependencies) ? task.dependencies.map((dep) => normalizeTaskKey(dep)) : [];
        for (const dep of deps) {
          if (!taskMap.has(dep)) {
            throw new Error(`任务 ${task.id} 依赖缺失：${dep}`);
          }
        }
        dependencyMap.set(taskKey, deps);
      }

      const completedTaskIds = new Set<string>();
      const scheduledTaskIds = new Set<string>();
      const pendingQueue = new Set<string>(taskMap.keys());
      const getReadyTaskId = () => {
        for (const taskId of pendingQueue) {
          const deps = dependencyMap.get(taskId) || [];
          if (deps.every((dep) => completedTaskIds.has(dep))) {
            return taskId;
          }
        }
        return null;
      };
      const markTaskCompleted = (taskId: string) => {
        completedTaskIds.add(taskId);
        pendingQueue.delete(taskId);
      };

      const workers = Array.from({ length: Math.min(concurrency, selectedTasks.length) }, async () => {
        while (true) {
          const decisionResp = await fetch("/api/coordinator-decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, plan: currentPlan, workerOutputs: outputStore, reviews: reviewStore, taskAttempts, settings: { workerRoleCounts, minimumReviewScore, maxReviewFixAttempts } }) });
          const decisionData = await decisionResp.json().catch(() => ({}));
          const decision = decisionData.decision || { readyTaskIds: [], blockedTaskIds: [], retryTaskIds: [], stopReason: "", canIntegrate: false, notes: [] };
          const nextTaskId = (decision.readyTaskIds || []).map((id: string) => normalizeTaskKey(id)).find((id: string) => pendingQueue.has(id) && !scheduledTaskIds.has(id)) || getReadyTaskId();
          appendCommunicationLog({ taskId: "coordinator", attempt: 1, from: "coordinator", to: "worker", timestamp: new Date().toISOString(), payload: decision });
          if (!nextTaskId) {
            if (completedTaskIds.size === selectedTasks.length) break;
            if (decision.stopReason) throw new Error(`Coordinator 停止：${decision.stopReason}`);
            if (scheduledTaskIds.size === completedTaskIds.size) {
              const blocked = Array.from(pendingQueue);
              throw new Error(`检测到循环依赖，阻塞任务：${blocked.join(", ")}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }
          const task = taskMap.get(nextTaskId);
          if (!task) throw new Error(`任务不存在：${nextTaskId}`);
          const deps = dependencyMap.get(nextTaskId) || [];
          const invalidDeps = deps.filter((dep) => !isReviewPassed(reviewStore[dep], minimumReviewScore));
          if (invalidDeps.length > 0) {
            const blockedReview: ReviewOutput = {
              taskId: nextTaskId,
              passed: false,
              issues: [`依赖任务未通过：${invalidDeps.join(", ")}`],
              suggestions: ["请先修复依赖任务后再执行当前任务。"],
              score: 0,
            };
            const blockedOutput: WorkerOutput = { taskId: nextTaskId, result: "blocked", filesSuggested: [], risks: [`依赖未通过：${invalidDeps.join(", ")}`], notes: "任务被阻塞，未执行 worker。", fixedIssues: [], remainingRisks: [`依赖未通过：${invalidDeps.join(", ")}`], changedFiles: [] };
            const blockedAttempt: TaskAttempt = { attempt: 1, workerOutput: blockedOutput, review: blockedReview, passed: false };
            outputStore[nextTaskId] = blockedOutput;
            reviewStore[nextTaskId] = blockedReview;
            setWorkerOutputs((prev) => ({ ...prev, [nextTaskId]: blockedOutput }));
            setReviews((prev) => ({ ...prev, [nextTaskId]: blockedReview }));
            allAttempts.push(blockedAttempt);
            setTaskAttempts((prev) => ({ ...prev, [nextTaskId]: [...(prev[nextTaskId] || []), blockedAttempt] }));
            appendCommunicationLog({ taskId: nextTaskId, attempt: 1, from: "system", to: "worker", timestamp: new Date().toISOString(), payload: { status: "blocked", dependencies: invalidDeps } });
            setProgress((prev) => ({ ...prev, phase: "blocked" }));
            scheduledTaskIds.add(nextTaskId);
            markTaskCompleted(nextTaskId);
            continue;
          }
          scheduledTaskIds.add(nextTaskId);
          const dependencyOutputMap = deps.reduce<Record<string, WorkerOutput>>((acc, dep) => {
            if (outputStore[dep]) acc[dep] = outputStore[dep];
            return acc;
          }, {});
          const attempts = await executeOneTask(task, activeConfig, outputStore, reviewStore, dependencyOutputMap);
          markTaskCompleted(nextTaskId);
          allAttempts.push(...attempts);
          const latestReview = attempts[attempts.length - 1]?.review;
          setProgress((prev) => ({ ...prev, done: prev.done + (isReviewPassed(latestReview, minimumReviewScore) ? 1 : 0) }));
        }
      });
      await Promise.all(workers);

      const unfinishedTasks = selectedTasks
        .map((task) => normalizeTaskKey(task.id))
        .filter((taskId) => !outputStore[taskId] || !reviewStore[taskId]);
      if (unfinishedTasks.length > 0) {
        throw new Error(`存在未完成任务，无法进入集成阶段：${unfinishedTasks.join(", ")}`);
      }

      const blockedTasks = getIntegrationBlockers(currentPlan, outputStore, reviewStore, minimumReviewScore);
      if (blockedTasks.length > 0) {
        throw new Error(`存在未通过评审的任务，无法进入集成阶段：${blockedTasks.join(", ")}`);
      }
      const finalDecisionResp = await fetch("/api/coordinator-decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, plan: currentPlan, workerOutputs: outputStore, reviews: reviewStore, taskAttempts, settings: { workerRoleCounts, minimumReviewScore, maxReviewFixAttempts } }) });
      const finalDecisionData = await finalDecisionResp.json().catch(() => ({}));
      if (!finalDecisionData?.decision?.canIntegrate) {
        throw new Error(`Coordinator 禁止进入集成：${finalDecisionData?.decision?.stopReason || "未满足集成条件"}`);
      }

      setLoading("integrating");
      appendCommunicationLog({ taskId: "integration", attempt: 1, from: "reviewer", to: "coordinator", timestamp: new Date().toISOString(), payload: { event: "all_reviews_collected", reviewCount: Object.keys(reviewStore).length } });
      appendCommunicationLog({ taskId: "integration", attempt: 1, from: "coordinator", to: "integration", timestamp: new Date().toISOString(), payload: { event: "coordinator_to_integration", taskCount: Object.keys(outputStore).length } });
      setProgress((prev) => ({ ...prev, phase: "integrating" }));
      const workerList = Object.values(outputStore);
      const reviewList = Object.values(reviewStore);
      const resp = await fetch("/api/integrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, plan: currentPlan, workerOutputs: workerList, reviews: reviewList, taskAttempts: allAttempts }) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `整合失败: ${resp.status}`);
      setIntegration(data.integration);
      appendCommunicationLog({ taskId: "final", attempt: 1, from: "system", to: "user", timestamp: new Date().toISOString(), payload: { event: "integration_to_final", status: data.integration?.status ?? "unknown" } });
      setProgress((prev) => ({ ...prev, done: prev.done + 1, phase: "done" }));
    } catch (error) {
      const detail: WorkflowErrorDetail = {
        stage: "finalAssembly",
        taskId: "task-006",
        attempt: 1,
        schemaName: "IntegrationOutput",
        rawValue: String((error as Error).message || ""),
        errorMessage: (error as Error).message,
        stack: (error as Error).stack || "",
      };
      setErrorMessage((error as Error).message);
      const hasBlockedTasks = Object.values(outputStore).some((output) => output?.result === "blocked");
      appendCommunicationLog({ taskId: "final", attempt: 1, from: "system", to: "user", timestamp: new Date().toISOString(), payload: { event: "integration_to_final", status: hasBlockedTasks ? "blocked" : "failed", error: (error as Error).message } });
      appendLog("error", "最终组装失败", detail);
      setProgress((prev) => ({ ...prev, phase: hasBlockedTasks ? "blocked" : "failed" }));
    } finally {
      setLoading("");
    }
  }

  async function generatePlanAndRun() {
    if (!config.model.trim()) {
      setErrorMessage("请先选择或输入模型后再生成计划。");
      return;
    }
    setLoading("planning");
    setErrorMessage("");
    setProgress({ total: 1, done: 0, phase: "planning" });
    try {
      const autoMatch = analyzeComplexity(requirement);
      const effectiveWorkerRoleCounts = autoMatchWorkerCounts ? autoMatch.workerRoleCounts : workerRoleCounts;
      const effectiveMaxConcurrentWorkers = autoMatchWorkerCounts ? autoMatch.maxConcurrentWorkers : Math.max(1, Math.floor(maxConcurrentWorkers));
      const effectiveMaxTasks = autoMatchWorkerCounts ? autoMatch.maxTasks : 5;
      if (autoMatchWorkerCounts) {
        setWorkerRoleCounts(effectiveWorkerRoleCounts);
        setMaxConcurrentWorkers(effectiveMaxConcurrentWorkers);
        const allocated = Object.values(effectiveWorkerRoleCounts).reduce((sum, n) => sum + Number(n || 0), 0);
        const summary = `自动匹配：检测为 ${autoMatch.complexity}，已分配 ${allocated} 个 AI，最大并发 ${effectiveMaxConcurrentWorkers}。`;
        setAutoMatchSummary(summary);
        appendLog("info", "自动匹配 AI 数量", { complexity: autoMatch.complexity, recommendedWorkerRoleCounts: effectiveWorkerRoleCounts, recommendedMaxConcurrentWorkers: effectiveMaxConcurrentWorkers, reason: autoMatch.reason });
        appendCommunicationLog({ taskId: "plan", attempt: 1, from: "system", to: "worker", timestamp: new Date().toISOString(), payload: { event: "auto_match_worker_counts", complexity: autoMatch.complexity, workerRoleCounts: effectiveWorkerRoleCounts, maxConcurrentWorkers: effectiveMaxConcurrentWorkers } });
      } else {
        setAutoMatchSummary("");
      }

      const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, requirement, maxTasks: effectiveMaxTasks, workerQuotas: effectiveWorkerRoleCounts }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `计划生成失败: ${r.status}`);
      if (!d.plan?.tasks?.length) throw new Error("计划生成失败：任务列表为空");

      appendLog("info", "计划生成成功", { taskCount: d.plan?.tasks?.length ?? 0 });
      setCommunicationLog([]);
      appendCommunicationLog({ taskId: "plan", attempt: 1, from: "system", to: "worker", timestamp: new Date().toISOString(), payload: { event: "planner_to_workers", taskCount: d.plan?.tasks?.length ?? 0 } });
      setPlan(d.plan);
      setWorkerOutputs({});
      setReviews({});
      setTaskAttempts({});
      setIntegration(null);
      setProgress({ total: 1, done: 1, phase: "planned" });

      await executeTasksAndIntegrate({ ...d.plan, __effectiveMaxConcurrentWorkers: effectiveMaxConcurrentWorkers } as ProjectPlan);
      appendLog("info", "工作流执行完成");
    } catch (error) {
      setErrorMessage((error as Error).message);
      appendLog("error", "生成计划或执行流程失败", (error as Error).message);
      setLoading("");
    }
  }

  async function downloadExport(format: ExportFormat) {
    if (!plan || !integration) return;
    setLoading(`exporting ${format}`);
    setErrorMessage("");
    try {
      const resp = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, plan, workerOutputs: Object.values(workerOutputs), reviews: Object.values(reviews), integration, taskAttempts: Object.values(taskAttempts).flat(), communicationLog }),
      });

      if (!resp.ok) {
        const errorBody = await resp.json().catch(() => null);
        throw new Error(errorBody?.error || `Export failed: ${resp.status}`);
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = resp.headers.get("Content-Disposition");
      const matched = disposition?.match(/filename=\"?([^\"]+)\"?/);
      const fallback = `workflow-result.${format}`;
      link.href = url;
      link.download = matched?.[1] ?? fallback;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading("");
    }
  }

  return <div className="container">
    <div className="panel">
      <h2>AI Multi-Agent Workflow MVP</h2>
      <input placeholder="API Base URL" value={config.baseURL} onChange={(e) => setConfig({ ...config, baseURL: e.target.value })} />
      <input placeholder="API Key" type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} />
      <button onClick={refreshModels} disabled={!config.apiKey || !!loading}>刷新模型</button>
      {models.length > 0 ? (
        <select value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })}>
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      ) : null}
      <input placeholder="Model Name (fallback)" value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
      <div className="status">模型状态：{modelStatus || "idle"}</div>

      <textarea rows={8} placeholder="输入你的项目需求..." value={requirement} onChange={(e) => setRequirement(e.target.value)} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <input type="checkbox" checked={autoMatchWorkerCounts} onChange={(e) => setAutoMatchWorkerCounts(e.target.checked)} style={{ width: 16, marginBottom: 0 }} />
        自动匹配 AI 数量
      </label>
      {autoMatchSummary ? <div className="status">{autoMatchSummary}</div> : null}
      <label>
        最多同时运行 worker 数量：
        <input type="number" min={1} value={maxConcurrentWorkers} readOnly={autoMatchWorkerCounts} onChange={(e) => setMaxConcurrentWorkers(Number(e.target.value) || 1)} />
      </label>
      <label>
        最低评审分数（低于该分数将要求重做）：
        <input type="number" min={0} max={100} value={minimumReviewScore} onChange={(e) => setMinimumReviewScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
      </label>
      <div>
        <div>按职位设置 AI 数量：</div>
        {Object.keys(workerRoleCounts).map((role) => (
          <label key={role} style={{ display: "block" }}>
            {role}:
            <input
              type="number"
              min={0}
              value={workerRoleCounts[role]}
              readOnly={autoMatchWorkerCounts}
              onChange={(e) => setWorkerRoleCounts((prev) => ({ ...prev, [role]: Math.max(0, Number(e.target.value) || 0) }))}
            />
          </label>
        ))}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input type="checkbox" checked={useCustomWorkerModel} onChange={(e) => setUseCustomWorkerModel(e.target.checked)} style={{ width: 16, marginBottom: 0 }} />
        使用自定义 Worker 模型
      </label>
      {useCustomWorkerModel ? (
        <input placeholder="Worker Model (optional API model)" value={customWorkerModel} onChange={(e) => setCustomWorkerModel(e.target.value)} />
      ) : null}

      <button onClick={generatePlanAndRun} disabled={!requirement || !config.apiKey || !config.model.trim() || !!loading}>生成计划并自动执行 + 合并</button>
      <div className="status">状态：{loading || "idle"}</div>
      <div className="status">进度：{progressPercent}%（{progress.done}/{progress.total}，{progress.phase}）</div>
      <progress value={progress.done} max={Math.max(progress.total, 1)} style={{ width: "100%", height: 12 }} />
      {errorMessage ? <div className="error-area"><strong>错误信息</strong><div>{getFriendlyErrorMessage(errorMessage)}</div></div> : null}
    </div>
    <div className="panel grid">
      <h3>项目计划</h3>
      <pre>{JSON.stringify(plan, null, 2)}</pre>
      <h3>任务</h3>
      {plan?.tasks.map((t) => {
        const taskKey = normalizeTaskKey(t.id);
        return <div key={taskKey} className="card">
        <strong>{t.id} - {t.name}</strong>
        <div>{t.description}</div>
        <div>Worker: {t.workerType}</div>
        <div>Status: {taskStatus[taskKey]}</div>
        <details>
          <summary>Attempt 历史</summary>
          <pre>{JSON.stringify(taskAttempts[taskKey] || [], null, 2)}</pre>
        </details>
      </div>;
      })}
      <h3>运行日志（实时）</h3>
      <pre>{JSON.stringify(appLogs, null, 2)}</pre>
      <h3>Agent Communication Log</h3>
      <pre>{JSON.stringify(communicationLog, null, 2)}</pre>
      <h3>Worker 输出</h3>
      <pre>{JSON.stringify(workerOutputs, null, 2)}</pre>
      <h3>Reviewer 反馈</h3>
      <pre>{JSON.stringify(reviews, null, 2)}</pre>
      <h3>最终合并结果</h3>
      {missingTasks.length > 0 ? (
        <div className="error-area">
          <strong>错误信息</strong>
          <div>缺失任务输出/评审：{missingTasks.join(", ")}</div>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <button onClick={downloadDiagnosticLog} disabled={!!loading}>下载诊断日志（随时）</button>
        <button onClick={() => downloadExport("md")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 Markdown</button>
        <button onClick={() => downloadExport("json")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 JSON</button>
        <button onClick={() => downloadExport("txt")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 TXT</button>
        <button onClick={() => downloadExport("zip")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 ZIP</button>
      </div>
      <pre>{JSON.stringify(integration, null, 2)}</pre>
    </div>
  </div>;
}
