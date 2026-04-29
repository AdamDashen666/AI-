"use client";

import { useMemo, useState } from "react";
import { AIConfig, CommunicationLogEntry, FixBrief, IntegrationOutput, ProjectPlan, ReviewOutput, TaskAttempt, WorkerOutput } from "@/lib/types";
import { getIntegrationBlockers } from "@/lib/workflow";

type TaskStatus = "idle" | "waiting_dependencies" | "done" | "passed" | "failed" | "blocked";
type ProgressPhase = "idle" | "planning" | "planned" | "running" | "integrating" | "done" | "failed" | "blocked";
type ExportFormat = "md" | "json" | "txt" | "zip";
type AppLogLevel = "info" | "warn" | "error";
type AppLogEntry = { timestamp: string; level: AppLogLevel; message: string; detail?: unknown };
type WorkflowErrorDetail = { stage: "parseWorkerOutput" | "validateSchema" | "startTask" | "reviewTask" | "finalAssembly"; taskId: string; attempt: number; schemaName: string; rawValue: string; errorMessage: string; stack: string };

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
  const [maxConcurrentWorkers, setMaxConcurrentWorkers] = useState<number>(2);
  const [minimumReviewScore, setMinimumReviewScore] = useState<number>(80);
  const [workerRoleCounts, setWorkerRoleCounts] = useState<Record<string, number>>({
    ui: 1,
    backend: 1,
    research: 1,
    code: 1,
    test: 1,
    integration: 1,
  });
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
      if (dependencies.length > 0 && dependencies.some((dep) => reviews[dep] && !reviews[dep]?.passed)) {
        map[taskKey] = "blocked";
      } else if (reviews[taskKey]) {
        map[taskKey] = reviews[taskKey].passed ? "passed" : "failed";
      } else if (workerOutputs[taskKey]) {
        map[taskKey] = "done";
      } else if (dependencies.length > 0 && dependencies.some((dep) => !reviewedTaskIds.has(dep))) {
        map[taskKey] = "waiting_dependencies";
      } else {
        map[taskKey] = "idle";
      }
    });
    return map;
  }, [plan, workerOutputs, reviews, taskAttempts]);

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
    try {
      for (let attempt = 1; attempt <= maxReviewFixAttempts; attempt += 1) {
        const previousOutputPayload = attempt > 1
          ? normalizePreviousOutput(currentOutput)
          : {};
        const dependencyOutputsPayload = attempt === 1
          ? normalizePreviousOutput(dependencyOutputMap)
          : {};
        appendCommunicationLog({ taskId: taskKey, attempt, from: "system", to: "worker", timestamp: new Date().toISOString(), payload: { previousOutput: previousOutputPayload, dependencyOutputs: dependencyOutputsPayload } });
        const runResp: Response = await fetch("/api/run-task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, task, requirement, attempt, previousOutput: previousOutputPayload, dependencyOutputs: dependencyOutputsPayload, previousReview: currentReview, fixBrief: attempts[attempts.length - 1]?.fixBrief }) });
        const runData: { output?: WorkerOutput; error?: string } = await runResp.json().catch(() => ({}));
        if (!runResp.ok || !runData.output) throw new Error(runData.error || `任务执行失败: ${runResp.status}`);
        currentOutput = runData.output;
        if (attempt > 1) {
          appendLog("info", `任务 ${taskKey} 修复轮 ${attempt} 输出`, {
            fixedIssues: currentOutput.fixedIssues || [],
            remainingRisks: currentOutput.remainingRisks || [],
            changedFiles: currentOutput.changedFiles || [],
          });
        }
        appendCommunicationLog({ taskId: taskKey, attempt, from: "worker", to: "reviewer", timestamp: new Date().toISOString(), payload: currentOutput as unknown as Record<string, unknown> });

        const reviewResp: Response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, task, output: currentOutput, fixBrief: attempts[attempts.length - 1]?.fixBrief }) });
        const reviewData: { review?: ReviewOutput; error?: string } = await reviewResp.json().catch(() => ({}));
        if (!reviewResp.ok || !reviewData.review) throw new Error(reviewData.error || `评审失败: ${reviewResp.status}`);
        currentReview = reviewData.review;
        appendCommunicationLog({ taskId: taskKey, attempt, from: "reviewer", to: currentReview?.passed ? "worker" : "coordinator", timestamp: new Date().toISOString(), payload: currentReview as unknown as Record<string, unknown> });

        const passedByScore = Number(currentReview.score) >= minimumReviewScore;
        const hasBlockingIssues = Array.isArray(currentReview.issues) && currentReview.issues.length > 0;
        const isPassed = Boolean(currentReview?.passed) && passedByScore && !hasBlockingIssues;
        if (!passedByScore) {
          currentReview = {
            ...currentReview,
            passed: false,
            issues: [...(currentReview.issues || []), `评分 ${currentReview.score} 低于用户设置的最低分 ${minimumReviewScore}`],
            suggestions: [...(currentReview.suggestions || []), "请针对问题逐条修复，并提高正确性、完整性和可维护性。"],
          };
        }
        const attemptItem: TaskAttempt = { attempt, workerOutput: currentOutput, review: currentReview, passed: isPassed };
        if (isPassed) {
          appendLog("info", `任务 ${taskKey} 在第 ${attempt} 轮评审通过`);
          attempts.push(attemptItem);
          break;
        }
        const coordinatorResp = await fetch("/api/fix-brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, requirement, task, attempt, previousOutput: currentOutput, review: currentReview }) });
        const coordinatorData = await coordinatorResp.json().catch(() => ({}));
        if (!coordinatorResp.ok || !coordinatorData.fixBrief) throw new Error(coordinatorData.error || `协调失败: ${coordinatorResp.status}`);
        const fixBrief: FixBrief = coordinatorData.fixBrief;
        attemptItem.fixBrief = fixBrief;
        appendCommunicationLog({ taskId: taskKey, attempt, from: "coordinator", to: "worker", timestamp: new Date().toISOString(), payload: fixBrief as unknown as Record<string, unknown> });
        attempts.push(attemptItem);
      }
    } catch (error) {
      const message = (error as Error).message || "未知错误";
      const detail: WorkflowErrorDetail = {
        stage: message.includes("评审") ? "reviewTask" : "startTask",
        taskId: taskKey,
        attempt: attempts.length + 1,
        schemaName: "WorkerOutput/ReviewOutput",
        rawValue: message,
        errorMessage: message,
        stack: (error as Error).stack || "",
      };
      currentOutput = currentOutput ?? {
        taskId: taskKey,
        result: `任务失败：${message}`,
        filesSuggested: [],
        risks: [message],
        notes: "Worker 执行失败，已生成兜底输出以避免流程卡住。",
        fixedIssues: [],
        remainingRisks: [message],
        changedFiles: [],
      };
      currentReview = currentReview ?? {
        taskId: taskKey,
        passed: false,
        issues: [message],
        suggestions: ["检查 API 配置、模型可用性与返回 JSON 格式后重试。"],
        score: 0,
      };
      attempts.push({ attempt: attempts.length + 1, workerOutput: currentOutput, review: currentReview, passed: false });
      appendCommunicationLog({ taskId: taskKey, attempt: attempts.length, from: "worker", to: "reviewer", timestamp: new Date().toISOString(), payload: currentOutput as unknown as Record<string, unknown> });
      appendCommunicationLog({ taskId: taskKey, attempt: attempts.length, from: "reviewer", to: "worker", timestamp: new Date().toISOString(), payload: currentReview as unknown as Record<string, unknown> });
      setErrorMessage((prev) => (prev ? `${prev}\n${task.id}: ${message}` : `${task.id}: ${message}`));
      appendLog("error", `任务 ${taskKey} 执行失败`, detail);
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
    const concurrency = Math.max(1, Math.floor(maxConcurrentWorkers));
    const selectedTasks = currentPlan.tasks;
    const outputStore: Record<string, WorkerOutput> = {};
    const reviewStore: Record<string, ReviewOutput> = {};
    const allAttempts: TaskAttempt[] = [];
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
          const nextTaskId = getReadyTaskId();
          if (!nextTaskId) {
            if (completedTaskIds.size === selectedTasks.length) break;
            if (scheduledTaskIds.size === completedTaskIds.size) {
              const blocked = Array.from(pendingQueue);
              throw new Error(`检测到循环依赖，阻塞任务：${blocked.join(", ")}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }
          if (scheduledTaskIds.has(nextTaskId)) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }
          const task = taskMap.get(nextTaskId);
          if (!task) throw new Error(`任务不存在：${nextTaskId}`);
          const deps = dependencyMap.get(nextTaskId) || [];
          const invalidDeps = deps.filter((dep) => !reviewStore[dep]?.passed);
          if (invalidDeps.length > 0) {
            const blockedReview: ReviewOutput = {
              taskId: nextTaskId,
              passed: false,
              issues: [`依赖任务未通过：${invalidDeps.join(", ")}`],
              suggestions: ["请先修复依赖任务后再执行当前任务。"],
              score: 0,
            };
            const blockedOutput: WorkerOutput = { taskId: nextTaskId, result: "blocked", filesSuggested: [], risks: [`依赖未通过：${invalidDeps.join(", ")}`], notes: "任务被阻塞，未执行 worker。", fixedIssues: [], remainingRisks: [`依赖未通过：${invalidDeps.join(", ")}`], changedFiles: [] };
            outputStore[nextTaskId] = blockedOutput;
            reviewStore[nextTaskId] = blockedReview;
            setWorkerOutputs((prev) => ({ ...prev, [nextTaskId]: blockedOutput }));
            setReviews((prev) => ({ ...prev, [nextTaskId]: blockedReview }));
            setTaskAttempts((prev) => ({ ...prev, [nextTaskId]: [...(prev[nextTaskId] || []), { attempt: 1, workerOutput: blockedOutput, review: blockedReview, passed: false }] }));
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
          setProgress((prev) => ({ ...prev, done: prev.done + (latestReview?.passed ? 1 : 0) }));
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

      setLoading("integrating");
      appendCommunicationLog({ taskId: "integration", attempt: 1, from: "worker", to: "system", timestamp: new Date().toISOString(), payload: { event: "workers_to_integration", taskCount: Object.keys(outputStore).length } });
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
      appendCommunicationLog({ taskId: "final", attempt: 1, from: "system", to: "user", timestamp: new Date().toISOString(), payload: { event: "integration_to_final", status: "failed", error: (error as Error).message } });
      appendLog("error", "最终组装失败", detail);
      setProgress((prev) => ({ ...prev, phase: "failed" }));
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
      const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, requirement, workerQuotas: workerRoleCounts }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `计划生成失败: ${r.status}`);

      appendLog("info", "计划生成成功", { taskCount: d.plan?.tasks?.length ?? 0 });
      setCommunicationLog([]);
      appendCommunicationLog({ taskId: "plan", attempt: 1, from: "system", to: "worker", timestamp: new Date().toISOString(), payload: { event: "planner_to_workers", taskCount: d.plan?.tasks?.length ?? 0 } });
      setPlan(d.plan);
      setWorkerOutputs({});
      setReviews({});
      setTaskAttempts({});
      setIntegration(null);
      setProgress({ total: 1, done: 1, phase: "planned" });

      await executeTasksAndIntegrate(d.plan);
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
      <label>
        最多同时运行 worker 数量：
        <input type="number" min={1} value={maxConcurrentWorkers} onChange={(e) => setMaxConcurrentWorkers(Number(e.target.value) || 1)} />
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
      {errorMessage ? <div className="status" style={{ color: "#b00020" }}>错误：{getFriendlyErrorMessage(errorMessage)}</div> : null}
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
        <div className="status" style={{ color: "#b00020" }}>
          缺失任务输出/评审：{missingTasks.join(", ")}
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
