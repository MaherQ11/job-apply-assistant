// Run with:  npm test
// Uses Node's built-in test runner — no extra packages.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findTerms, matchJob } from "../src/match.js";

const profile = {
  contact: { name: "Test", email: "t@example.com" },
  skills: { languages: ["Python", "SQL"], tools: ["Excel", "Power BI"] },
  experience: [
    { id: "exp_a", title: "Data Analyst", company: "X", bullets: ["Built Power BI dashboards"], skills: [] },
  ],
  projects: [
    { id: "proj_b", name: "Churn", bullets: ["Random Forest model with scikit-learn"], skills: [] },
  ],
};

test("finds terms case-insensitively and counts repeats", () => {
  const t = findTerms("python, PYTHON and sql");
  assert.equal(t.get("Python"), 2);
  assert.equal(t.get("SQL"), 1);
});

test("matches whole words only", () => {
  const t = findTerms("Cloudflare, nodejs-like, javascript");
  assert.ok(!t.has("Cloud"), "Cloudflare should not count as Cloud");
  assert.ok(t.has("JavaScript"));
  assert.ok(!t.has("Java"), "JavaScript should not count as Java");
});

test("aliases with spaces also match hyphen or no space", () => {
  assert.ok(findTerms("PowerBI").has("Power BI"));
  assert.ok(findTerms("power-bi").has("Power BI"));
});

test("R language is detected, but not inside R&D or HR", () => {
  assert.ok(findTerms("Knowledge of R is a plus").has("R"));
  assert.ok(!findTerms("Work with HR and R&D teams").has("R"));
});

test("Arabic aliases work with attached prefixes", () => {
  const t = findTerms("مهارات تحليل البيانات وإتقان الإكسل وبايثون");
  assert.ok(t.has("Data Analysis"));
  assert.ok(t.has("Excel"));
  assert.ok(t.has("Python"));
});

test("score, matched, missing and evidence", () => {
  const ad = "We need Python, SQL and Tableau. SQL is a must.";
  const r = matchJob(ad, profile);

  // SQL appears twice -> weight 2; Python 1; Tableau 1 -> total 4, matched 3
  assert.equal(r.score, 75);
  assert.deepEqual(r.missing.map((m) => m.term), ["Tableau"]);

  const sql = r.matched.find((m) => m.term === "SQL");
  assert.equal(sql.weight, 2);
  assert.deepEqual(sql.evidence, ["skills"]);
});

test("evidence points to the profile item that proves the skill", () => {
  const r = matchJob("Experience with scikit-learn and dashboards", profile);
  const sk = r.matched.find((m) => m.term === "Scikit-learn");
  assert.deepEqual(sk.evidence, ["proj_b"]);
  const dash = r.matched.find((m) => m.term === "Dashboards");
  assert.deepEqual(dash.evidence, ["exp_a"]);
});

test("empty ad gives score 0 without crashing", () => {
  const r = matchJob("", profile);
  assert.equal(r.score, 0);
  assert.equal(r.total_terms, 0);
});
