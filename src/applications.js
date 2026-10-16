// Application tracker — validation + stats (pure functions, easy to test).
// Storage: one KV key "applications" holding an array (fine for a personal tool).

export const STATUSES = ["applied", "interview", "rejected", "offer"];

const MAX = { company: 120, title: 160, url: 500, location: 120, notes: 2000 };

const isStr = (v) => typeof v === "string";
const clean = (v, max) => (isStr(v) ? v.trim().slice(0, max) : "");

/**
 * Validate + normalize input for a new or updated application.
 * partial=true (updates): only the fields present are checked.
 * Returns { value, errors }.
 */
export function validateApplication(input, { partial = false } = {}) {
  const errors = [];
  const value = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { value, errors: ["body must be a JSON object"] };
  }
  const has = (k) => input[k] !== undefined;

  for (const f of ["company", "title"]) {
    if (!partial || has(f)) {
      value[f] = clean(input[f], MAX[f]);
      if (!value[f]) errors.push(`${f}: required`);
    }
  }

  if (has("url")) {
    const url = clean(input.url, MAX.url);
    if (url && !/^https?:\/\//i.test(url)) errors.push("url: must start with http:// or https://");
    value.url = url;
  } else if (!partial) value.url = "";

  if (has("location")) value.location = clean(input.location, MAX.location);
  if (has("notes")) value.notes = clean(input.notes, MAX.notes);

  if (!partial || has("date_applied")) {
    const d = isStr(input.date_applied) && input.date_applied ? input.date_applied : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) errors.push("date_applied: use YYYY-MM-DD");
    value.date_applied = d;
  }

  if (!partial || has("status")) {
    const s = input.status === undefined ? "applied" : input.status;
    if (!STATUSES.includes(s)) errors.push(`status: must be one of ${STATUSES.join(", ")}`);
    value.status = s;
  }

  if (has("match_score")) {
    const n = Number(input.match_score);
    if (input.match_score === null || input.match_score === "") value.match_score = null;
    else if (!Number.isFinite(n) || n < 0 || n > 100) errors.push("match_score: 0-100");
    else value.match_score = Math.round(n);
  }

  // The tailored CV/cover letter from the "Check reply" step (kept as-is, size-limited)
  if (has("tailored")) {
    if (input.tailored === null) value.tailored = null;
    else if (typeof input.tailored !== "object") errors.push("tailored: must be an object");
    else if (JSON.stringify(input.tailored).length > 20000) errors.push("tailored: too large");
    else value.tailored = input.tailored;
  }

  return { value, errors };
}

/** Simple stats for the dashboard tiles. */
export function computeStats(apps, today = new Date()) {
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const a of apps) if (by[a.status] !== undefined) by[a.status]++;

  const total = apps.length;
  const responded = by.interview + by.rejected + by.offer; // got any answer back
  const scores = apps.map((a) => a.match_score).filter((n) => typeof n === "number");

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekStart = weekAgo.toISOString().slice(0, 10);

  const pct = (n) => (total ? Math.round((100 * n) / total) : 0);
  return {
    total,
    by_status: by,
    response_rate: pct(responded),               // % that got any reply
    interview_rate: pct(by.interview + by.offer), // % that reached interview or better
    avg_match_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    last_7_days: apps.filter((a) => a.date_applied >= weekStart).length,
  };
}
