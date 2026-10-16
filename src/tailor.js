// CV tailoring — "copy-paste mode" (works with a normal Claude subscription, no API key).
//
//   buildPrompt(jobText, profile, match)  -> a ready prompt you paste into Claude
//   checkTailored(responseText, profile)  -> parses Claude's reply and flags anything
//                                            that isn't backed by your profile
//
// Anti-fabrication works in two layers:
//   1. The prompt forbids inventing anything and forces every bullet to cite a profile id.
//   2. The checker verifies that in code — Claude's promise isn't trusted on its own.

import { findTerms } from "./match.js";

// ---------- Prompt ----------

// Only what's needed for tailoring. Phone/email/links aren't sent anywhere.
function profileForPrompt(profile) {
  const { contact = {}, ...rest } = profile;
  return { name: contact.name, title: contact.title, location: contact.location, ...rest };
}

export function buildPrompt(jobText, profile, match) {
  const matched = match.matched.map((m) => `${m.term} (proof: ${m.evidence.join(", ")})`).join("; ") || "none";
  const missing = match.missing.map((m) => m.term).join(", ") || "none";

  return `You are an expert CV writer for data roles in Saudi Arabia. Tailor my CV to the job ad below.

## STRICT RULES — read carefully
1. Use ONLY facts that appear in MY PROFILE. Never invent skills, tools, numbers, employers, dates, responsibilities, or results.
2. You MAY rephrase, reorder, shorten, and choose which facts to emphasize so they match the job's wording — as long as the meaning stays true.
3. These keywords are in the job ad but NOT in my profile: ${missing}. Do NOT claim them anywhere (not in the summary, bullets, skills, or cover letter).
4. Every bullet must have a "source_id" that is an id from MY PROFILE (experience or projects) and must only use facts from that item.
5. Keep all numbers exactly as they appear in my profile. Do not add new numbers.
6. Bullets: start with a strong past-tense action verb, no "I", max 25 words each, 2-4 bullets per item. Only include items relevant to this job.
7. Summary: 3-4 sentences, third person without a name (e.g. "Data analyst with..."), focused on this job.
8. Cover letter: English, max 200 words, addressed to the hiring team. Mention the company and job title if the ad states them. Sign it with my name.
9. Respond with ONLY one JSON code block matching the format below — no extra text.

## OUTPUT FORMAT
\`\`\`json
{
  "job": { "company": "", "title": "" },
  "summary": "",
  "experience": [ { "source_id": "exp_...", "bullets": [""] } ],
  "projects": [ { "source_id": "proj_...", "bullets": [""] } ],
  "skills_to_highlight": [""],
  "cover_letter": ""
}
\`\`\`

## KEYWORD MATCH (computed by code)
Score: ${match.score}%
Already in my profile: ${matched}
Missing (do not claim): ${missing}

## MY PROFILE
\`\`\`json
${JSON.stringify(profileForPrompt(profile), null, 2)}
\`\`\`

## JOB AD
"""
${jobText.trim()}
"""`;
}

// ---------- Check Claude's reply ----------

// The empty example in OUTPUT FORMAT — must never be mistaken for a real answer.
const isTemplate = (obj) =>
  JSON.stringify(obj).includes('"exp_..."') || JSON.stringify(obj).includes('"proj_..."');

// A real answer has these keys (the profile JSON block in the prompt doesn't).
const looksLikeAnswer = (obj) =>
  obj && typeof obj === "object" && ("summary" in obj || "cover_letter" in obj) && !isTemplate(obj);

// Pull Claude's answer out of the pasted text. The paste may contain extra text,
// several code blocks, or even the whole prompt + reply — so try every candidate,
// starting from the LAST one (Claude's answer comes after the prompt).
function extractJson(text) {
  const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1)); // no code fences at all

  for (const c of candidates.reverse()) {
    try {
      const obj = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
      if (looksLikeAnswer(obj)) return obj;
    } catch { /* not valid JSON — try the next candidate */ }
  }

  if (text.includes("## STRICT RULES") && text.includes("## MY PROFILE")) {
    throw new Error(
      "this is the prompt, but no reply from Claude was found in it. " +
      "Paste the prompt into Claude first, then copy Claude's answer (the JSON block) and paste that here"
    );
  }
  throw new Error("no answer JSON found (expected a code block with summary, experience, cover_letter...)");
}

// "10,000" -> "10000", "20.37%" -> "20.37"
const numbersIn = (text) =>
  new Set((String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, "")));

export function checkTailored(responseText, profile) {
  const errors = [];
  const warnings = [];

  let out;
  try {
    out = extractJson(String(responseText || ""));
  } catch (err) {
    return { ok: false, errors: ["Could not read the reply as JSON: " + err.message], warnings, data: null };
  }

  // What the profile can prove
  const items = new Map(); // id -> { section, label }
  for (const e of profile.experience || []) items.set(e.id, { section: "experience", label: `${e.title} — ${e.company}` });
  for (const p of profile.projects || []) items.set(p.id, { section: "projects", label: p.name });

  const profileText = JSON.stringify(profile);
  const profileTerms = new Set(findTerms(profileText).keys());
  const profileNumbers = numbersIn(profileText);
  const profileSkills = new Set([
    ...Object.values(profile.skills || {}).flat(),
    ...[...(profile.experience || []), ...(profile.projects || [])].flatMap((i) => i.skills || []),
  ].map((s) => s.toLowerCase()));

  // Flags skill keywords and numbers that don't exist anywhere in the profile.
  function scan(where, text) {
    if (!text) return;
    for (const term of findTerms(text).keys()) {
      if (!profileTerms.has(term)) warnings.push(`${where}: mentions "${term}", which isn't in your profile`);
    }
    for (const n of numbersIn(text)) {
      if (!profileNumbers.has(n)) warnings.push(`${where}: number "${n}" doesn't appear in your profile`);
    }
  }

  // Required text fields
  for (const f of ["summary", "cover_letter"]) {
    if (typeof out[f] !== "string" || !out[f].trim()) errors.push(`"${f}" is missing or empty`);
  }
  scan("Summary", out.summary);

  // Bullets must cite a real item from the right section
  const data = { job: out.job || {}, summary: out.summary || "", experience: [], projects: [], skills_to_highlight: [], cover_letter: out.cover_letter || "" };

  for (const section of ["experience", "projects"]) {
    const list = out[section] || [];
    if (!Array.isArray(list)) { errors.push(`"${section}" must be a list`); continue; }

    list.forEach((entry, i) => {
      const id = entry && entry.source_id;
      const item = items.get(id);
      if (!item) return errors.push(`${section}[${i}]: source_id "${id}" doesn't exist in your profile — removed`);
      if (item.section !== section) return errors.push(`${section}[${i}]: "${id}" belongs in ${item.section} — removed`);

      const bullets = (Array.isArray(entry.bullets) ? entry.bullets : []).filter((b) => typeof b === "string" && b.trim());
      bullets.forEach((b, j) => scan(`${item.label} • bullet ${j + 1}`, b));
      data[section].push({ source_id: id, label: item.label, bullets });
    });
  }

  // Highlighted skills must be in the profile
  for (const s of Array.isArray(out.skills_to_highlight) ? out.skills_to_highlight : []) {
    if (typeof s !== "string" || !s.trim()) continue;
    // Accept if it's in a skills list, OR it's a known keyword the profile text proves
    // (e.g. "Dashboards" from "Built Power BI dashboards").
    const terms = [...findTerms(s).keys()];
    const proven = terms.length > 0 && terms.every((t) => profileTerms.has(t));
    if (profileSkills.has(s.toLowerCase()) || proven) data.skills_to_highlight.push(s);
    else warnings.push(`Skill "${s}" isn't in your profile — removed`);
  }

  scan("Cover letter", out.cover_letter);

  return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], data };
}
