# AI Multi-Agent Workflow MVP

## Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Features
- Planner -> Worker -> Reviewer -> Integrator workflow
- Adds Coordinator/Guide AI on review-fail path: Worker -> Reviewer -> Coordinator(FixBrief) -> Worker -> Reviewer
- Task attempts history and Agent Communication Log timeline
- workflow-data.json now stores full communication log and attempt data
- OpenAI-compatible API config (baseURL, key, model)
- JSON fallback parser
