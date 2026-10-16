import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, checkTailored } from "../src/tailor.js";
import { matchJob } from "../src/match.js";

const profile = {
  contact: { name: "Test User", email: "secret@example.com", phone: "+966 500000000" },
  skills: { languages: ["Python", "SQL"], tools: ["Power BI"] },
  experience: [
    { id: "exp_a", title: "Data Analyst", company: "X", bullets: ["Built Power BI dashboards for 3 teams"], skills: [] },
  ],
  projects: [
    { id: "proj_b", name: "Churn", bullets: ["Analyzed 10,000 customers with SQL"], skills: ["SQL"] },
  ],
};

const reply = (obj) => "Here you go:\n```json\n" + JSON.stringify(obj) + "\n```";

const good = {
  job: { company: "Acme", title: "Data Analyst" },
  summary: "Data analyst skilled in Python, SQL and Power BI.",
  experience: [{ source_id: "exp_a", bullets: ["Built Power BI dashboards used by 3 teams"] }],
  projects: [{ source_id: "proj_b", bullets: ["Analyzed 10,000 customers using SQL"] }],
  skills_to_highlight: ["SQL", "power bi"],
  cover_letter: "Dear Hiring Team, ... Test User",
};

test("prompt includes rules, missing keywords and job ad, but not phone/email", () => {
  const ad = "Need SQL, Python and Tableau.";
  const p = buildPrompt(ad, profile, matchJob(ad, profile));
  assert.match(p, /Use ONLY facts/);
  assert.match(p, /Missing \(do not claim\): Tableau/);
  assert.match(p, /Need SQL, Python and Tableau\./);
  assert.ok(!p.includes("secret@example.com"));
  assert.ok(!p.includes("500000000"));
});

test("a clean reply passes with no errors or warnings", () => {
  const r = checkTailored(reply(good), profile);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.data.experience[0].label, "Data Analyst — X");
});

test("unknown source_id is an error and the item is removed", () => {
  const r = checkTailored(reply({ ...good, experience: [{ source_id: "exp_fake", bullets: ["x"] }] }), profile);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /exp_fake/);
  assert.equal(r.data.experience.length, 0);
});

test("invented skill and invented number are flagged", () => {
  const r = checkTailored(reply({
    ...good,
    summary: "Expert in Tableau with 5 years of experience.",
  }), profile);
  assert.ok(r.warnings.some((w) => w.includes('"Tableau"')));
  assert.ok(r.warnings.some((w) => w.includes('"5"')));
});

test("highlighted skills not in the profile are removed", () => {
  const r = checkTailored(reply({ ...good, skills_to_highlight: ["SQL", "Spark"] }), profile);
  assert.deepEqual(r.data.skills_to_highlight, ["SQL"]);
  assert.ok(r.warnings.some((w) => w.includes("Spark")));
});

test("highlighted skill proven by a bullet (not in skills list) is kept", () => {
  // "Dashboards" isn't in skills, but exp_a says "Built Power BI dashboards"
  const r = checkTailored(reply({ ...good, skills_to_highlight: ["Dashboards", "Tableau"] }), profile);
  assert.deepEqual(r.data.skills_to_highlight, ["Dashboards"]);
  assert.ok(r.warnings.some((w) => w.includes("Tableau")));
});

test("finds the real answer even when the whole prompt is pasted before it", () => {
  const ad = "Need SQL, Python and Tableau for this role please.";
  const prompt = buildPrompt(ad, profile, matchJob(ad, profile));
  const r = checkTailored(prompt + "\n\nClaude:\n" + reply(good), profile);
  assert.equal(r.ok, true);
  assert.equal(r.data.summary, good.summary);
});

test("pasting only the prompt gives a helpful error, not the empty template", () => {
  const ad = "Need SQL, Python and Tableau for this role please.";
  const r = checkTailored(buildPrompt(ad, profile, matchJob(ad, profile)), profile);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /no reply from Claude/);
});

test("reply without code fences still works", () => {
  const r = checkTailored(JSON.stringify(good), profile);
  assert.equal(r.ok, true);
});

test("garbage reply gives a clear error", () => {
  const r = checkTailored("Sorry, I can't help with that.", profile);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /JSON/);
});

test("upgrading the language level (e.g. 'fluent') is flagged", () => {
  const withLang = { ...profile, languages: [{ name: "English", level: "Working proficiency" }] };
  const r = checkTailored(reply({ ...good, summary: "Data analyst, fluent in English." }), withLang);
  assert.ok(r.warnings.some((w) => w.includes('"fluent"')));
  const ok = checkTailored(reply(good), withLang);
  assert.ok(!ok.warnings.some((w) => w.startsWith("Language")));
});
