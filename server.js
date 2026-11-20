// BE8 AI Coworker web app: serves the UI and proxies chat to the Lyzr agent,
// injecting the signed-in employee's HR record so answers are personalised.
import express from "express";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const LYZR_API_KEY = process.env.LYZR_API_KEY;
const LYZR_AGENT_ID =
  process.env.LYZR_AGENT_ID || JSON.parse(readFileSync(path.join(root, "lyzr.config.json"), "utf8")).agent_id;
const LYZR_CHAT_URL = "https://agent-prod.studio.lyzr.ai/v3/inference/chat/";

if (!LYZR_API_KEY) console.warn("LYZR_API_KEY is not set - chat requests will fail.");

// Mock HR system (stands in for the real HRIS in this demo)
const employees = JSON.parse(readFileSync(path.join(root, "data/employees.json"), "utf8"));
const findEmployee = (id) => employees.find((e) => e.id === id);

// Same documents that were uploaded to the Lyzr knowledge base, served so users can check sources
const docs = readdirSync(path.join(root, "kb"))
  .filter((f) => f.endsWith(".txt"))
  .sort()
  .map((file) => {
    const text = readFileSync(path.join(root, "kb", file), "utf8");
    const [, code, title] = text.match(/^DOCUMENT:\s*(\S+)\s+(.+)$/m) || [];
    return { code, title, text };
  });

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }) +
    " (" + new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Bangkok" }) + ")";
}

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(root, "public")));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/api/employees", (_req, res) => {
  res.json(employees.map(({ id, name, nickname, title, department }) => ({ id, name, nickname, title, department })));
});

app.get("/api/employees/:id", (req, res) => {
  const employee = findEmployee(req.params.id);
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json(employee);
});

app.get("/api/docs", (_req, res) => res.json(docs.map(({ code, title }) => ({ code, title }))));

app.get("/api/docs/:code", (req, res) => {
  const doc = docs.find((d) => d.code === req.params.code);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.json(doc);
});

app.post("/api/chat", async (req, res) => {
  const { employeeId, message, sessionId } = req.body || {};
  const employee = findEmployee(employeeId);
  if (!employee) return res.status(400).json({ error: "Unknown employee" });
  if (typeof message !== "string" || !message.trim() || message.length > 2000)
    return res.status(400).json({ error: "Message must be 1-2000 characters" });

  try {
    const lyzr = await fetch(LYZR_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": LYZR_API_KEY },
      body: JSON.stringify({
        user_id: employee.email,
        agent_id: LYZR_AGENT_ID,
        session_id: `${LYZR_AGENT_ID}-${employee.id}-${String(sessionId || "default").slice(0, 40)}`,
        message: message.trim(),
        system_prompt_variables: { today: today(), employee_context: JSON.stringify(employee, null, 1) },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await lyzr.json().catch(() => ({}));
    if (!lyzr.ok || typeof data.response !== "string") {
      console.error("Lyzr error", lyzr.status, JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: "The AI Coworker is unavailable right now. Please try again." });
    }
    res.json({ response: data.response });
  } catch (err) {
    console.error("Lyzr request failed", err);
    res.status(502).json({ error: "The AI Coworker took too long to answer. Please try again." });
  }
});

app.listen(PORT, () => console.log(`BE8 AI Coworker running on http://localhost:${PORT}`));
