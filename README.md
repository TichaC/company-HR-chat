# BE8 AI Coworker

An employee knowledge chatbot for Beryl 8, built on a **Lyzr Agent Studio** agent and served as a web app on **Render**.

- **Company knowledge** (leave, health insurance, payroll, expenses, hybrid work, IT) lives in a Lyzr knowledge base built from [`kb/`](kb/).
- **Personal answers** ("how many leave days do I have left?") come from the signed-in employee's HR record ([`data/employees.json`](data/employees.json), a mock HRIS). The server passes it to the agent as a system prompt variable, so the agent only ever sees that one employee's data.
- Every answer ends with its sources. The UI turns them into chips that open the cited document section or the employee's HR record.

All company data, people and the insurer ("SafeCare") are **mock data for the demo**.

## Lyzr resources

| | ID |
|---|---|
| Agent "BE8 AI Coworker" | `6affa16f4fdf4fe1ecb81200` |
| Knowledge base `be8_ai_coworker_kb` | `6affa2eea57f7e5d64316666` |

To change the prompt or add documents, edit `scripts/agent-prompt.mjs` or add a `kb/*.txt` file (use `[CODE Section N - Title]` headings), then run:

```bash
npm run setup-lyzr
```

It reuses the IDs in `lyzr.config.json`, uploads only new files and updates the agent. After editing an existing `kb/` file, run `npm run setup-lyzr -- --rebuild` to train a fresh knowledge base, switch the agent to it and delete the old one.

Conversation history is kept by the app, not by Lyzr memory: the browser sends the last few turns, and the server passes them to the agent as "already answered" context. With Lyzr's short-term memory on, the agent kept re-answering earlier questions.

> Note: Lyzr's multipart `/v3/train/txt/` endpoint reports success but indexes nothing for these files, so the script uses the JSON `/v3/train/text/` endpoint with one chunk per section.

## Run locally

```bash
npm install
echo "LYZR_API_KEY=your-key" > .env
npm run dev
```

Open http://localhost:3000.

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render: **New → Blueprint**, pick the repository. Render reads `render.yaml`.
3. Paste your Lyzr API key when Render asks for `LYZR_API_KEY`, then **Apply**.

The free plan sleeps after 15 minutes idle, so the first request after a pause takes about a minute.
