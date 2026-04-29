"use client";

import { useMemo, useState } from "react";
import { AIConfig, IntegrationOutput, ProjectPlan, ReviewOutput, WorkerOutput } from "@/lib/types";

type TaskStatus = "idle" | "done" | "reviewed";
type ExportFormat = "md" | "json" | "txt" | "zip";

export default function HomePage() {
  const [config, setConfig] = useState<AIConfig>({ baseURL: "https://api.openai.com/v1", apiKey: "", model: "" });
  const [requirement, setRequirement] = useState("");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [workerOutputs, setWorkerOutputs] = useState<Record<string, WorkerOutput>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewOutput>>({});
  const [integration, setIntegration] = useState<IntegrationOutput | null>(null);
  const [loading, setLoading] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<string>("");
  const [maxConcurrentWorkers, setMaxConcurrentWorkers] = useState<number>(2);
  const [useCustomWorkerModel, setUseCustomWorkerModel] = useState<boolean>(false);
  const [customWorkerModel, setCustomWorkerModel] = useState<string>("");
  const [progress, setProgress] = useState({ total: 0, done: 0, phase: "idle" });

  const taskStatus = useMemo(() => {
    const map: Record<string, TaskStatus> = {};
    plan?.tasks.forEach((t) => {
      if (reviews[t.id]) map[t.id] = "reviewed";
      else if (workerOutputs[t.id]) map[t.id] = "done";
      else map[t.id] = "idle";
    });
    return map;
  }, [plan, workerOutputs, reviews]);

  const progressPercent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const missingTasks = useMemo(() => {
    if (!plan) return [];
    return plan.tasks.filter((task) => !workerOutputs[task.id] || !reviews[task.id]).map((task) => task.id);
  }, [plan, workerOutputs, reviews]);

  async function refreshModels() {
    setModelStatus("正在刷新模型...");
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
    } catch (error) {
      setModelStatus(`刷新失败：${(error as Error).message}`);
      setErrorMessage((error as Error).message);
    }
  }

  async function executeOneTask(
    task: ProjectPlan["tasks"][number],
    activeConfig: AIConfig,
    outputStore: Record<string, WorkerOutput>,
    reviewStore: Record<string, ReviewOutput>,
  ) {
    const runResp = await fetch("/api/run-task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, task, requirement }) });
    const runData = await runResp.json();
    if (!runResp.ok) throw new Error(runData.error || `任务执行失败: ${runResp.status}`);

    outputStore[task.id] = runData.output;
    setWorkerOutputs((prev) => ({ ...prev, [task.id]: runData.output }));

    const reviewResp = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, task, output: runData.output }) });
    const reviewData = await reviewResp.json();
    if (!reviewResp.ok) throw new Error(reviewData.error || `评审失败: ${reviewResp.status}`);

    reviewStore[task.id] = reviewData.review;
    setReviews((prev) => ({ ...prev, [task.id]: reviewData.review }));
  }

  async function executeTasksAndIntegrate(currentPlan: ProjectPlan) {
    setLoading("running tasks");
    const activeConfig = useCustomWorkerModel && customWorkerModel.trim() ? { ...config, model: customWorkerModel.trim() } : config;
    const concurrency = Math.max(1, Math.floor(maxConcurrentWorkers));
    const selectedTasks = currentPlan.tasks;
    const outputStore: Record<string, WorkerOutput> = {};
    const reviewStore: Record<string, ReviewOutput> = {};
    setProgress({ total: selectedTasks.length + 1, done: 0, phase: "running" });

    try {
      let index = 0;
      const workers = Array.from({ length: Math.min(concurrency, selectedTasks.length) }, async () => {
        while (true) {
          const current = index;
          index += 1;
          if (current >= selectedTasks.length) break;
          await executeOneTask(selectedTasks[current], activeConfig, outputStore, reviewStore);
          setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      });
      await Promise.all(workers);

      setLoading("integrating");
      const workerList = Object.values(outputStore);
      const reviewList = Object.values(reviewStore);
      const resp = await fetch("/api/integrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, plan: currentPlan, workerOutputs: workerList, reviews: reviewList }) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `整合失败: ${resp.status}`);
      setIntegration(data.integration);
      setProgress((prev) => ({ ...prev, done: prev.total, phase: "done" }));
    } catch (error) {
      setErrorMessage((error as Error).message);
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
      const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, requirement }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `计划生成失败: ${r.status}`);

      setPlan(d.plan);
      setWorkerOutputs({});
      setReviews({});
      setIntegration(null);
      setProgress({ total: 1, done: 1, phase: "planned" });

      await executeTasksAndIntegrate(d.plan);
    } catch (error) {
      setErrorMessage((error as Error).message);
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
        body: JSON.stringify({ format, plan, workerOutputs: Object.values(workerOutputs), reviews: Object.values(reviews), integration }),
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
      {errorMessage ? <div className="status" style={{ color: "#b00020" }}>错误：{errorMessage}</div> : null}
    </div>
    <div className="panel grid">
      <h3>项目计划</h3>
      <pre>{JSON.stringify(plan, null, 2)}</pre>
      <h3>任务</h3>
      {plan?.tasks.map((t) => <div key={t.id} className="card">
        <strong>{t.id} - {t.name}</strong>
        <div>{t.description}</div>
        <div>Worker: {t.workerType}</div>
        <div>Status: {taskStatus[t.id]}</div>
      </div>)}
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
        <button onClick={() => downloadExport("md")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 Markdown</button>
        <button onClick={() => downloadExport("json")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 JSON</button>
        <button onClick={() => downloadExport("txt")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 TXT</button>
        <button onClick={() => downloadExport("zip")} disabled={!integration || integration.status !== "complete" || !plan || !!loading}>下载 ZIP</button>
      </div>
      <pre>{JSON.stringify(integration, null, 2)}</pre>
    </div>
  </div>;
}
