// Creates (or updates) the BE8 knowledge base and agent in Lyzr Agent Studio.
// Usage: LYZR_API_KEY=... node scripts/setup-lyzr.mjs
// Re-running reuses the IDs saved in lyzr.config.json and updates the agent prompt.
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agent } from "./agent-prompt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "lyzr.config.json");
const API_KEY = process.env.LYZR_API_KEY;
const AGENT_API = "https://agent-prod.studio.lyzr.ai";
const RAG_API = "https://rag-prod.studio.lyzr.ai";
const RAG_NAME = "be8_ai_coworker_kb";

if (!API_KEY) {
  console.error("Set LYZR_API_KEY first.");
  process.exit(1);
}

async function call(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "x-api-key": API_KEY, ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || "GET"} ${url} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

let config = {};
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch {}

// --rebuild: after editing existing kb/ files, train a fresh knowledge base and drop the old one
const previousRagId = process.argv.includes("--rebuild") ? config.rag_id : null;
if (previousRagId) {
  delete config.rag_id;
  config.trained = [];
}

// 1. Knowledge base
if (!config.rag_id) {
  const rag = await call(
    `${RAG_API}/v3/rag/`,
    json("POST", {
      user_id: "be8-ai-coworker",
      description: "BE8 AI Coworker demo - company policies, benefits, leave, payroll, IT (mock data)",
      collection_name: RAG_NAME,
      llm_credential_id: "lyzr_openai",
      embedding_credential_id: "lyzr_openai",
      vector_db_credential_id: "lyzr_qdrant",
      vector_store_provider: "Qdrant [Lyzr]",
      llm_model: "gpt-4o-mini",
      embedding_model: "text-embedding-ada-002",
      semantic_data_model: false,
      meta_data: {},
    })
  );
  config.rag_id = rag.id || rag._id;
  config.rag_name = RAG_NAME;
  config.trained = [];
  console.log("Created knowledge base", config.rag_id);
}

// 2. Upload documents (skips files already trained).
// The multipart /v3/train/txt/ endpoint reports success but indexes nothing, so we send
// text as JSON, one chunk per "[CODE Section N]" block, each prefixed with the document header
// so every retrieved chunk carries its document code for citations.
const kbDir = path.join(root, "kb");
for (const file of (await readdir(kbDir)).filter((f) => f.endsWith(".txt")).sort()) {
  if (config.trained?.includes(file)) continue;
  const text = await readFile(path.join(kbDir, file), "utf8");
  const [header, ...sections] = text.split(/\n(?=\[)/);
  const title = header.split("\n")[0];
  const data = sections.map((section) => ({ text: `${title}\n${section.trim()}`, source: file, extra_info: {} }));
  const out = await call(
    `${RAG_API}/v3/train/text/?rag_id=${config.rag_id}`,
    json("POST", { data, chunk_size: 1500, chunk_overlap: 0 })
  );
  config.trained = [...(config.trained || []), file];
  console.log("Trained", file, "-", out.message || "ok");
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

// 3. Agent
const agentBody = {
  ...agent,
  provider_id: "OpenAI",
  model: "gpt-4o",
  llm_credential_id: "lyzr_openai",
  temperature: 0.2,
  top_p: 0.9,
  tools: [],
  store_messages: true,
  features: [
    {
      type: "KNOWLEDGE_BASE",
      config: {
        lyzr_rag: {
          base_url: RAG_API,
          rag_id: config.rag_id,
          rag_name: config.rag_name,
          params: { top_k: 8, retrieval_type: "basic", score_threshold: 0 },
        },
        agentic_rag: [],
      },
      priority: 0,
    },
    // Lyzr long-term memory, scoped to user_id (the employee's email) and shared across chats
    {
      type: "MEMORY",
      config: { provider: "cognis", lyzr_memory: { provider_type: "cognis", params: { cross_session: true } } },
      priority: 0,
    },
  ],
};

if (config.agent_id) {
  await call(`${AGENT_API}/v3/agents/${config.agent_id}`, json("PUT", agentBody));
  console.log("Updated agent", config.agent_id);
} else {
  const created = await call(`${AGENT_API}/v3/agents/`, json("POST", agentBody));
  config.agent_id = created.agent_id;
  console.log("Created agent", config.agent_id);
}

await writeFile(configPath, JSON.stringify(config, null, 2));

if (previousRagId) {
  await call(`${RAG_API}/v3/rag/${previousRagId}/`, { method: "DELETE" });
  console.log("Deleted previous knowledge base", previousRagId);
}
console.log(`\nDone. Set LYZR_AGENT_ID=${config.agent_id} on Render.`);
