// Job Apply Assistant — Cloudflare Worker (API)
//
//   GET  /api/health      public  — is the Worker alive?
//   GET  /api/auth-check  private — is my token correct?
//   GET  /api/profile     private — read the CV profile from KV
//   PUT  /api/profile     private — validate + save the CV profile to KV
//   POST /api/match       private — ATS keyword match: job ad vs saved profile (no AI)
//   POST /api/prompt      private — build the tailoring prompt to paste into Claude
//   POST /api/check       private — verify Claude's reply against the profile
//   GET    /api/applications      private — list + stats
//   POST   /api/applications      private — add an application
//   PUT    /api/applications/:id  private — update (e.g. status)
//   DELETE /api/applications/:id  private — delete
//
// Every /api/* route except /api/health requires:
//   Authorization: Bearer <APP_TOKEN>
// APP_TOKEN lives in .dev.vars locally, and as a Worker secret in production.

import { matchJob } from "./match.js";
import { buildPrompt, checkTailored } from "./tailor.js";
import { validateApplication, computeStats } from "./applications.js";

const PUBLIC_ROUTES = new Set(["/api/health"]);
const MAX_BODY_BYTES = 100 * 1024; // 100 KB is plenty for a CV profile

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Not an API call: serve the static UI (index.html, etc.)
    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Auth gate for everything except public routes
    if (!PUBLIC_ROUTES.has(path)) {
      const authError = await checkAuth(request, env);
      if (authError) return authError;
    }

    try {
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, time: new Date().toISOString() });
      }

      if (path === "/api/auth-check" && method === "GET") {
        return json({ ok: true, authenticated: true });
      }

      if (path === "/api/profile" && method === "GET") return getProfile(env);
      if (path === "/api/profile" && method === "PUT") return putProfile(request, env);
      if (path === "/api/match" && method === "POST") return postMatch(request, env);
      if (path === "/api/prompt" && method === "POST") return postPrompt(request, env);
      if (path === "/api/check" && method === "POST") return postCheck(request, env);

      if (path === "/api/applications" && method === "GET") return listApplications(env);
      if (path === "/api/applications" && method === "POST") return createApplication(request, env);
      const appMatch = path.match(/^\/api\/applications\/([a-f0-9-]{36})$/);
      if (appMatch && method === "PUT") return updateApplication(request, env, appMatch[1]);
      if (appMatch && method === "DELETE") return deleteApplication(env, appMatch[1]);

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "server error" }, 500);
    }
  },
};

// ---------- Profile ----------

async function getProfile(env) {
  const stored = await env.DB.get("profile", "json");
  if (!stored) return json({ profile: null, updated_at: null });
  return json(stored); // { profile, updated_at }
}

async function putProfile(request, env) {
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, 400);

  const profile = body.value;
  const errors = validateProfile(profile);
  if (errors.length) return json({ error: "invalid profile", details: errors }, 400);

  const record = { profile, updated_at: new Date().toISOString() };
  await env.DB.put("profile", JSON.stringify(record));
  return json({ ok: true, updated_at: record.updated_at, counts: countSections(profile) });
}

// Checks the structure we rely on later (tailoring needs stable ids
// so every generated bullet can point back to a real experience/project).
function validateProfile(p) {
  const errors = [];
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const isStr = (v) => typeof v === "string" && v.trim() !== "";

  if (!isObj(p)) return ["profile must be a JSON object"];

  if (!isObj(p.contact)) errors.push("contact: required object");
  else {
    for (const f of ["name", "email"]) {
      if (!isStr(p.contact[f])) errors.push(`contact.${f}: required text`);
    }
  }

  if (p.languages !== undefined) {
    if (!Array.isArray(p.languages) || !p.languages.every((l) => isObj(l) && isStr(l.name) && isStr(l.level))) {
      errors.push("languages: must be a list of { name, level }");
    }
  }

  if (p.skills !== undefined) {
    if (!isObj(p.skills)) errors.push("skills: must be an object of lists");
    else {
      for (const [k, v] of Object.entries(p.skills)) {
        if (!Array.isArray(v) || !v.every(isStr)) errors.push(`skills.${k}: must be a list of text`);
      }
    }
  }

  // Sections with items that need a unique id
  const seenIds = new Set();
  const sections = {
    education: ["degree", "school"],
    experience: ["title", "company"],
    projects: ["name"],
    certifications: ["name"],
  };

  for (const [section, requiredFields] of Object.entries(sections)) {
    const list = p[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { errors.push(`${section}: must be a list`); continue; }

    list.forEach((item, i) => {
      const where = `${section}[${i}]`;
      if (!isObj(item)) { errors.push(`${where}: must be an object`); return; }

      if (!isStr(item.id)) errors.push(`${where}.id: required text`);
      else if (!/^[a-z0-9_]+$/.test(item.id)) errors.push(`${where}.id: use only a-z, 0-9, _`);
      else if (seenIds.has(item.id)) errors.push(`${where}.id: duplicate id "${item.id}"`);
      else seenIds.add(item.id);

      for (const f of requiredFields) {
        if (!isStr(item[f])) errors.push(`${where}.${f}: required text`);
      }
      for (const listField of ["bullets", "skills"]) {
        const v = item[listField];
        if (v !== undefined && (!Array.isArray(v) || !v.every(isStr))) {
          errors.push(`${where}.${listField}: must be a list of text`);
        }
      }
    });
  }

  return errors;
}

function countSections(p) {
  const n = (k) => (Array.isArray(p[k]) ? p[k].length : 0);
  return {
    education: n("education"),
    experience: n("experience"),
    projects: n("projects"),
    certifications: n("certifications"),
    skills: p.skills ? Object.values(p.skills).flat().length : 0,
  };
}

// ---------- Match + Tailor ----------

// Shared: read body, validate job_text, load profile. Returns { jobText, profile } or { error: Response }.
async function jobAndProfile(request, env) {
  const body = await readJson(request);
  if (body.error) return { error: json({ error: body.error }, 400) };

  const jobText = body.value && body.value.job_text;
  if (typeof jobText !== "string" || jobText.trim().length < 30) {
    return { error: json({ error: "job_text is required (paste the full job ad)" }, 400) };
  }
  const profile = await loadProfile(env);
  if (!profile) return { error: json({ error: "no profile saved yet — save your CV profile first" }, 400) };
  return { jobText, profile };
}

async function loadProfile(env) {
  const stored = await env.DB.get("profile", "json");
  return stored ? stored.profile : null;
}

async function postMatch(request, env) {
  const r = await jobAndProfile(request, env);
  if (r.error) return r.error;
  return json(matchJob(r.jobText, r.profile));
}

async function postPrompt(request, env) {
  const r = await jobAndProfile(request, env);
  if (r.error) return r.error;
  const match = matchJob(r.jobText, r.profile);
  return json({ prompt: buildPrompt(r.jobText, r.profile, match), match });
}

async function postCheck(request, env) {
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, 400);

  const responseText = body.value && body.value.response_text;
  if (typeof responseText !== "string" || !responseText.trim()) {
    return json({ error: "response_text is required (paste Claude's reply)" }, 400);
  }
  const profile = await loadProfile(env);
  if (!profile) return json({ error: "no profile saved yet — save your CV profile first" }, 400);

  return json(checkTailored(responseText, profile));
}

// ---------- Applications ----------

const loadApps = async (env) => (await env.DB.get("applications", "json")) || [];
const saveApps = (env, apps) => env.DB.put("applications", JSON.stringify(apps));

// Newest application date first, then newest created
const sortApps = (apps) =>
  apps.sort((a, b) => b.date_applied.localeCompare(a.date_applied) || b.created_at.localeCompare(a.created_at));

async function listApplications(env) {
  const apps = sortApps(await loadApps(env));
  return json({ applications: apps, stats: computeStats(apps) });
}

async function createApplication(request, env) {
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, 400);
  const { value, errors } = validateApplication(body.value);
  if (errors.length) return json({ error: "invalid application", details: errors }, 400);

  const now = new Date().toISOString();
  const app = { id: crypto.randomUUID(), match_score: null, tailored: null, notes: "", location: "", ...value, created_at: now, updated_at: now };
  const apps = await loadApps(env);
  apps.push(app);
  await saveApps(env, apps);
  return json(app, 201);
}

async function updateApplication(request, env, id) {
  const body = await readJson(request);
  if (body.error) return json({ error: body.error }, 400);
  const { value, errors } = validateApplication(body.value, { partial: true });
  if (errors.length) return json({ error: "invalid application", details: errors }, 400);

  const apps = await loadApps(env);
  const i = apps.findIndex((a) => a.id === id);
  if (i === -1) return json({ error: "not found" }, 404);
  apps[i] = { ...apps[i], ...value, updated_at: new Date().toISOString() };
  await saveApps(env, apps);
  return json(apps[i]);
}

async function deleteApplication(env, id) {
  const apps = await loadApps(env);
  const next = apps.filter((a) => a.id !== id);
  if (next.length === apps.length) return json({ error: "not found" }, 404);
  await saveApps(env, next);
  return json({ ok: true });
}

// ---------- Auth ----------

async function checkAuth(request, env) {
  // Fail closed: if the server has no token configured, nobody gets in.
  if (!env.APP_TOKEN) {
    return json({ error: "server not configured: APP_TOKEN is missing" }, 500);
  }

  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token || !(await safeEqual(token, env.APP_TOKEN))) {
    return json({ error: "unauthorized" }, 401);
  }
  return null; // OK
}

// Constant-time comparison (avoids timing attacks).
// Hash both strings first so they always have the same length.
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- Helpers ----------

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: "body too large" };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: "body is not valid JSON" };
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
