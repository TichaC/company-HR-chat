// BE8 AI Coworker front end: demo sign-in, chat with the Lyzr agent (via /api/chat),
// and source chips that open the cited company document or the employee's HR record.
const $ = (sel) => document.querySelector(sel);
const state = { employee: null, busy: false, docCache: {} };

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

const thb = (n) => "฿" + Number(n).toLocaleString("en-US");
const initials = (name) => name.split(" ").map((p) => p[0]).slice(0, 2).join("");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const docIcon = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const personIcon = '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

/* ---------- Sign-in ---------- */
async function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
  const list = await api("/api/employees");
  $("#employee-list").innerHTML = list
    .map((e) => `
      <button class="employee-card" data-id="${e.id}">
        <div class="avatar">${initials(e.name)}</div>
        <div><strong>${escapeHtml(e.name)} (${escapeHtml(e.nickname)})</strong><span>${escapeHtml(e.title)} · ${escapeHtml(e.department)}</span></div>
      </button>`)
    .join("");
}

$("#employee-list").addEventListener("click", (ev) => {
  const card = ev.target.closest(".employee-card");
  if (card) signIn(card.dataset.id);
});

async function signIn(id) {
  try {
    state.employee = await api(`/api/employees/${encodeURIComponent(id)}`);
  } catch {
    store.remove("be8-employee");
    return showLogin();
  }
  store.set("be8-employee", id);
  $("#login").hidden = true;
  $("#app").hidden = false;
  renderSidebar();
  startNewChat();
}

$("#switch-user").addEventListener("click", () => {
  store.remove("be8-employee");
  closeSidebar();
  showLogin();
});

/* ---------- Sidebar ---------- */
function alertsFor(e) {
  const alerts = [];
  const missing = e.health.recentClaims.find((c) => /missing/i.test(c.status));
  if (missing) alerts.push(`Claim needs documents: ${missing.status.replace(/^Documents missing:\s*/i, "")}`);
  if (/not booked/i.test(e.health.healthCheck2026)) alerts.push("Annual health check not booked yet");
  const month = new Date().toLocaleString("en-US", { month: "long" });
  if (e.leave.birthday.remaining > 0 && e.birthMonth === month) alerts.push("Birthday leave must be used this month");
  const pending = e.leave.recent.find((l) => /pending/i.test(l.status));
  if (pending) alerts.push(`${pending.days} day(s) leave pending approval`);
  return alerts.slice(0, 2);
}

function renderSidebar() {
  const e = state.employee;
  $("#profile").innerHTML = `
    <div class="avatar">${initials(e.name)}</div>
    <div><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(e.title)} · ${escapeHtml(e.jobLevel)}<br>${escapeHtml(e.department)}</span></div>`;
  const a = e.leave.annual;
  const alerts = alertsFor(e)
    .map((t) => `<div class="tile wide alert"><div class="value">${escapeHtml(t)}</div></div>`)
    .join("");
  $("#snapshot").innerHTML = `
    <div class="tile"><div class="value">${a.remaining}<small> / ${a.entitled}</small></div><div class="label">Annual leave days left</div></div>
    <div class="tile"><div class="value">${e.leave.sick.remaining}</div><div class="label">Sick leave days left</div></div>
    <div class="tile"><div class="value">${thb(e.health.opd.remaining)}</div><div class="label">OPD budget left (${escapeHtml(e.health.plan)})</div></div>
    <div class="tile"><div class="value">${thb(e.health.dental.remaining)}</div><div class="label">Dental budget left</div></div>
    <div class="tile wide"><div class="value">${fmtDate(e.payroll.nextPayDate)}</div><div class="label">Next pay day</div></div>
    ${alerts}`;
}

$("#open-record").addEventListener("click", () => { closeSidebar(); openRecord(); });

/* ---------- Chat ---------- */
const SUGGESTIONS = [
  "How many leave days do I have left?",
  "How do I claim health insurance at a non-network clinic?",
  "How much OPD budget do I have left?",
  "What's the status of my latest insurance claim?",
  "เงินเดือนออกวันไหน",
  "ลาป่วยต้องใช้ใบรับรองแพทย์ไหม",
];

function startNewChat() {
  const e = state.employee;
  $("#messages").innerHTML = `
    <div class="welcome">
      <h2>Hi ${escapeHtml(e.nickname)}, <span>how can I help?</span></h2>
      <p>I know BE8's policies and your own HR record, and I remember what you've told me in earlier chats. Ask in English or Thai. Every answer shows the document it came from, so you can check it.</p>
    </div>`;
  $("#suggestions").innerHTML = SUGGESTIONS.map((s) => `<button type="button" class="suggestion">${escapeHtml(s)}</button>`).join("");
  $("#suggestions").hidden = false;
  $("#input").value = "";
  autosize();
}

$("#new-chat").addEventListener("click", startNewChat);
$("#suggestions").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".suggestion");
  if (btn) send(btn.textContent);
});

function appendMessage(role, html, extraClass = "") {
  const el = document.createElement("div");
  el.className = `msg ${role} ${extraClass}`;
  el.innerHTML = role === "bot"
    ? `<div class="bot-avatar"><img src="be8-logo.png" alt=""></div><div class="bubble">${html}</div>`
    : `<div class="bubble">${html}</div>`;
  $("#messages").appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
  return el;
}

// Split the agent's trailing "Sources: HR-POL-002 §3; My HR record" line into chips.
function parseSources(text) {
  const match = text.match(/\n\s*[*_]*(?:Sources?|แหล่งที่มา|ที่มา|อ้างอิง)[*_]*\s*:\s*([^\n]+)\s*$/i);
  if (!match) return { body: text, sources: [] };
  const body = text.slice(0, match.index).trimEnd();
  const sources = [];
  for (const raw of match[1].split(/[;,]/)) {
    const part = raw.replace(/[*_`]/g, "").trim();
    if (!part) continue;
    if (/hr record|ข้อมูล.*พนักงาน/i.test(part)) {
      if (!sources.some((s) => s.type === "record")) sources.push({ type: "record" });
      continue;
    }
    const code = part.match(/\b([A-Z]{2,4}(?:-[A-Z]{3})?-\d{3})\b/);
    if (!code) continue;
    const section = part.match(/(?:§|Section\s*|ข้อ\s*)(\d+)/i);
    const existing = sources.find((s) => s.code === code[1]);
    if (existing) { if (section) existing.sections.push(section[1]); }
    else sources.push({ type: "doc", code: code[1], sections: section ? [section[1]] : [] });
  }
  return { body, sources };
}

function sourcesHtml(sources) {
  if (!sources.length) return "";
  const chips = sources.map((s) =>
    s.type === "record"
      ? `<button class="chip record" data-record="1">${personIcon}My HR record</button>`
      : `<button class="chip" data-code="${escapeHtml(s.code)}" data-sections="${s.sections.join(",")}">${docIcon}${escapeHtml(s.code)}${s.sections.length ? " · §" + s.sections.join(", §") : ""}</button>`
  );
  return `<div class="sources"><span class="label">Sources</span>${chips.join("")}</div>`;
}

async function send(text) {
  const message = text.trim();
  if (!message || state.busy) return;
  state.busy = true;
  $("#send").disabled = true;
  $("#suggestions").hidden = true;
  $("#messages .welcome")?.remove();
  $("#input").value = "";
  autosize();

  const firstMessage = !$("#messages .msg.user");
  appendMessage("user", escapeHtml(message));
  const pending = appendMessage("bot", '<span class="typing"><i></i><i></i><i></i></span><span class="typing-note">Checking company documents…</span>');

  try {
    const { response } = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: state.employee.id, message, firstMessage }),
    });
    const { body, sources } = parseSources(response);
    pending.querySelector(".bubble").innerHTML = DOMPurify.sanitize(marked.parse(body)) + sourcesHtml(sources);
  } catch (err) {
    pending.classList.add("error");
    pending.querySelector(".bubble").textContent = err.message;
  } finally {
    pending.scrollIntoView({ behavior: "smooth", block: "end" });
    state.busy = false;
    $("#send").disabled = false;
    $("#input").focus();
  }
}

$("#composer").addEventListener("submit", (ev) => { ev.preventDefault(); send($("#input").value); });
$("#input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send($("#input").value); }
});
function autosize() {
  const el = $("#input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}
$("#input").addEventListener("input", autosize);

$("#messages").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  if (chip.dataset.record) openRecord();
  else openDoc(chip.dataset.code, chip.dataset.sections ? chip.dataset.sections.split(",") : []);
});

/* ---------- Drawer: source document / HR record ---------- */
function openDrawer(kicker, title, html) {
  $("#drawer-kicker").textContent = kicker;
  $("#drawer-title").textContent = title;
  $("#drawer-body").innerHTML = html;
  $("#drawer-body").scrollTop = 0;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("show");
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  if (!$("#sidebar").classList.contains("open")) $("#scrim").classList.remove("show");
}
$("#close-drawer").addEventListener("click", closeDrawer);
$("#scrim").addEventListener("click", () => { closeDrawer(); closeSidebar(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closeDrawer(); closeSidebar(); } });

async function openDoc(code, sections) {
  let doc = state.docCache[code];
  if (!doc) {
    try { doc = state.docCache[code] = await api(`/api/docs/${encodeURIComponent(code)}`); }
    catch { return openDrawer("Source document", code, '<p class="muted">This document could not be loaded.</p>'); }
  }
  const [header, ...parts] = doc.text.split(/\n(?=\[)/);
  const meta = header.split("\n").slice(1).filter(Boolean).map(escapeHtml).join("<br>");
  const body = parts.map((part) => {
    const [, heading, rest] = part.match(/^\[([^\]]+)\]\n?([\s\S]*)$/) || [null, "", part];
    const num = (heading.match(/(?:Section|ข้อ)\s+(\d+)/) || [])[1];
    const cited = num && sections.includes(num);
    return `<div class="doc-section${cited ? " cited" : ""}"><h3>${escapeHtml(heading)}</h3>${escapeHtml(rest.trim())}</div>`;
  }).join("");
  openDrawer(doc.code, doc.title, `<div class="doc-meta">${meta}</div>${body}`);
  $("#drawer-body .cited")?.scrollIntoView({ block: "center" });
}

function openRecord() {
  const e = state.employee;
  const row = (k, v) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`;
  const group = (title, rows) => `<div class="record-group"><h3>${title}</h3><table class="record-table">${rows.join("")}</table></div>`;
  const a = e.leave.annual;
  const html = [
    group("Employee", [
      row("Employee ID", e.id), row("Position", `${e.title} (${e.jobLevel})`), row("Department", e.department),
      row("Manager", e.manager), row("Joined", fmtDate(e.joinDate)), row("Work location", e.workLocation),
    ]),
    group(`Leave ${e.leave.year}`, [
      row("Annual leave", `${a.remaining} left of ${a.entitled} (used ${a.used}, pending ${a.pending})`),
      row("Carried over from last year", `${a.carriedOver} (used ${a.carriedOverUsed})`),
      row("Sick leave", `${e.leave.sick.remaining} left of ${e.leave.sick.entitled}`),
      row("Personal leave", `${e.leave.personal.remaining} left of ${e.leave.personal.entitled}`),
      row("Birthday leave", `${e.leave.birthday.remaining} left · ${e.leave.birthday.note}`),
      ...e.leave.recent.map((l) => row(`${l.type} · ${l.dates}`, `${l.days} day(s) · ${l.status}`)),
    ]),
    group(`Health insurance · ${e.health.plan} plan`, [
      row("Insurer / member ID", `${e.health.insurer} · ${e.health.memberId}`),
      row("OPD", `${thb(e.health.opd.remaining)} left of ${thb(e.health.opd.annualCap)} · ${e.health.opd.visitsUsed}/${e.health.opd.visitsAllowed} visits`),
      row("Dental", `${thb(e.health.dental.remaining)} left of ${thb(e.health.dental.annualCap)}`),
      row("Annual health check", e.health.healthCheck2026),
      row("Dependants", e.health.dependants.length ? e.health.dependants.join(", ") : "None"),
      ...e.health.recentClaims.map((c) => row(`${fmtDate(c.date)} · ${c.type}`, `${thb(c.amount)} · ${c.status}`)),
    ]),
    group("Pay & welfare", [
      row("Next pay day", fmtDate(e.payroll.nextPayDate)),
      row("Provident fund", `You ${e.payroll.providentFund.employeeRate} · Company ${e.payroll.providentFund.companyRate} · Vested ${e.payroll.providentFund.vested}`),
      row("Fitness allowance", `${thb(e.payroll.fitnessAllowance.remaining)} left of ${thb(e.payroll.fitnessAllowance.annual)}`),
      row("Learning budget", `${thb(e.payroll.learningBudget.remaining)} left of ${thb(e.payroll.learningBudget.annual)}`),
    ]),
    '<p class="record-note">From the BE8 People Portal (mock data for this demo). The AI Coworker only sees your own record.</p>',
  ].join("");
  openDrawer("My HR record", e.name, html);
}

/* ---------- Mobile sidebar ---------- */
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  if (!$("#drawer").classList.contains("open")) $("#scrim").classList.remove("show");
}
$("#toggle-sidebar").addEventListener("click", () => {
  $("#sidebar").classList.add("open");
  $("#scrim").classList.add("show");
});

/* ---------- Boot ---------- */
const saved = store.get("be8-employee");
if (saved) signIn(saved); else showLogin();
