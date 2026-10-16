import { test } from "node:test";
import assert from "node:assert/strict";
import { validateApplication, computeStats } from "../src/applications.js";

test("valid application gets defaults (status applied, today's date)", () => {
  const { value, errors } = validateApplication({ company: " JTI ", title: "Commercial Planning Specialist" });
  assert.deepEqual(errors, []);
  assert.equal(value.company, "JTI");
  assert.equal(value.status, "applied");
  assert.match(value.date_applied, /^\d{4}-\d{2}-\d{2}$/);
});

test("missing company/title, bad status, bad URL and bad date are rejected", () => {
  const { errors } = validateApplication({
    company: "", status: "ghosted", url: "javascript:alert(1)", date_applied: "16/10/2026",
  });
  assert.ok(errors.some((e) => e.startsWith("company")));
  assert.ok(errors.some((e) => e.startsWith("title")));
  assert.ok(errors.some((e) => e.startsWith("status")));
  assert.ok(errors.some((e) => e.startsWith("url")));
  assert.ok(errors.some((e) => e.startsWith("date_applied")));
});

test("partial update only checks the fields sent", () => {
  const { value, errors } = validateApplication({ status: "interview" }, { partial: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { status: "interview" });
});

test("match score must be 0-100", () => {
  assert.ok(validateApplication({ company: "a", title: "b", match_score: 140 }).errors.length);
  assert.equal(validateApplication({ company: "a", title: "b", match_score: "81" }).value.match_score, 81);
});

test("stats: counts, response rate, interview rate, average score, last 7 days", () => {
  const today = new Date("2026-10-16T12:00:00Z");
  const apps = [
    { status: "applied", match_score: 80, date_applied: "2026-10-16" },
    { status: "interview", match_score: 60, date_applied: "2026-10-12" },
    { status: "rejected", match_score: null, date_applied: "2026-10-01" },
    { status: "offer", match_score: 70, date_applied: "2026-09-20" },
  ];
  const s = computeStats(apps, today);
  assert.equal(s.total, 4);
  assert.deepEqual(s.by_status, { applied: 1, interview: 1, rejected: 1, offer: 1 });
  assert.equal(s.response_rate, 75);  // 3 of 4 got a reply
  assert.equal(s.interview_rate, 50); // interview + offer
  assert.equal(s.avg_match_score, 70);
  assert.equal(s.last_7_days, 2);
});

test("stats on an empty list don't divide by zero", () => {
  const s = computeStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.response_rate, 0);
  assert.equal(s.avg_match_score, null);
});
