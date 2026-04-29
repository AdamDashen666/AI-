"use client";

import { useMemo, useState } from "react";
import { AIConfig, IntegrationOutput, PlanTask, ProjectPlan, ReviewOutput, WorkerOutput } from "@/lib/types";

type TaskStatus = "idle" | "running" | "done" | "reviewed";

export default function HomePage() {
  const [config, setConfig] = useState<AIConfig>({ baseURL: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" });
  const [requirement, setRequirement] = useState("");
  const [maxParallelWorkers, setMaxParallelWorkers] = useState<number>(5);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [workerOutputs, setWorkerOutputs] = useState<Record<string, WorkerOutput>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewOutput>>({});
  const [runningTasks, setRunningTasks] = useState<Record<string, boolean>>({});
  const [integration, setIntegration] = useState<IntegrationOutput | null>(null);
  const [loading, setLoading] = useState<string>("");

  const taskStatus = useMemo(() => {
    const map: Record<string, TaskStatus> = {};
    plan?.tasks.forEach((t) => {
      if (reviews[t.id]) map[t.id] = "reviewed";
      else if (runningTasks[t.id]) map[t.id] = "running";
      else if (workerOutputs[t.id]) map[t.id] = "done";
      else map[t.id] = "idle";
    });
    return map;
  }, [plan, reviews, runningTasks, workerOutputs]);

  async function generatePlan() {
    setLoading("planning");
    const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, requirement }) });
    const d = await r.json();
    setPlan(d.plan);
    setWorkerOutputs({});
    setReviews({});
    setRunningTasks({});
    setIntegration(null);
    setLoading("");
  }

  async function processSingleTask(task: PlanTask) {
    setRunningTasks((prev) => ({ ...prev, [task.id]: true }));

    const runResp = await fetch("/api/run-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, task, requirement }),
    });
    const runData = await runResp.json();

    setWorkerOutputs((prev) => ({ ...prev, [task.id]: runData.output }));

    const reviewResp = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, task, output: runData.output }),
    });
    const reviewData = await reviewResp.json();

    setReviews((prev) => ({ ...prev, [task.id]: reviewData.review }));
    setRunningTasks((prev) => ({ ...prev, [task.id]: false }));
  }

  async function executeTasks() {
    if (!plan) return;
    setLoading("running tasks");

    const concurrency = Math.max(1, Math.floor(maxParallelWorkers || 1));
    const queue = [...plan.tasks];

    const worker = async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) return;
        await processSingleTask(task);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.all(workers);
    setLoading("");
  }

  async function integrate() {
    if (!plan) return;
    setLoading("integrating");
    const resp = await fetch("/api/integrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, plan, workerOutputs: Object.values(workerOutputs), reviews: Object.values(reviews) }),
    });
    const data = await resp.json();
    setIntegration(data.integration);
    setLoading("");
  }

  return <div className="container">
    <div className="panel">
      <h2>AI Multi-Agent Workflow MVP</h2>
      <input placeholder="API Base URL" value={config.baseURL} onChange={(e) => setConfig({ ...config, baseURL: e.target.value })} />
      <input placeholder="API Key" type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} />
      <input placeholder="Model Name" value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
      <input
        placeholder="Max Parallel Workers"
        type="number"
        min={1}
        value={maxParallelWorkers}
        onChange={(e) => setMaxParallelWorkers(Number(e.target.value) || 1)}
      />
      <textarea rows={8} placeholder="输入你的项目需求..." value={requirement} onChange={(e) => setRequirement(e.target.value)} />
      <button onClick={generatePlan} disabled={!requirement || !config.apiKey || !!loading}>生成计划</button>
      <button onClick={executeTasks} disabled={!plan || !!loading}>执行任务</button>
      <button onClick={integrate} disabled={!plan || !!loading}>合并结果</button>
      <div className="status">状态：{loading || "idle"}</div>
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
      <pre>{JSON.stringify(integration, null, 2)}</pre>
    </div>
  </div>;
}
