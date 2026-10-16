// ATS-style keyword matching — pure JavaScript, no AI.
//
// How it works:
//   1. Find which known skills/keywords appear in the job ad (using the dictionary below).
//   2. Look for the same keywords in your profile (skills, titles, bullets).
//   3. Score = weighted share of the job's keywords that your profile covers.
//      A keyword mentioned 2+ times in the ad counts double (it's probably important).
//
// The result is deterministic: the same ad + profile always gives the same score,
// and every match points to the profile items (ids) that prove it.

// ---------- Dictionary ----------
// term: the name shown in results.  aliases: other ways it's written (English + Arabic).
// Aliases are matched case-insensitively as whole words; spaces also match "-" or no space.
export const DICTIONARY = [
  // Languages
  { term: "Python", group: "language", aliases: ["python", "بايثون"] },
  { term: "SQL", group: "language", aliases: ["sql"] },
  { term: "R", group: "language", aliases: [], pattern: /(?<![\p{L}\p{N}&])R(?![\p{L}\p{N}&+#'])/u },
  { term: "JavaScript", group: "language", aliases: ["javascript", "js"] },
  { term: "Java", group: "language", aliases: ["java"] },
  { term: "Scala", group: "language", aliases: ["scala"] },
  { term: "DAX", group: "language", aliases: ["dax"] },

  // BI & spreadsheets
  { term: "Excel", group: "tool", aliases: ["excel", "ms excel", "إكسل", "اكسل"] },
  { term: "Power BI", group: "tool", aliases: ["power bi", "powerbi", "باور بي آي"] },
  { term: "Tableau", group: "tool", aliases: ["tableau"] },
  { term: "Looker", group: "tool", aliases: ["looker", "looker studio"] },
  { term: "Qlik", group: "tool", aliases: ["qlik", "qlikview", "qlik sense"] },
  { term: "Power Query", group: "tool", aliases: ["power query"] },

  // Python data stack
  { term: "Pandas", group: "tool", aliases: ["pandas"] },
  { term: "NumPy", group: "tool", aliases: ["numpy"] },
  { term: "Scikit-learn", group: "tool", aliases: ["scikit-learn", "scikit learn", "sklearn"] },
  { term: "TensorFlow", group: "tool", aliases: ["tensorflow", "keras"] },
  { term: "PyTorch", group: "tool", aliases: ["pytorch"] },
  { term: "Jupyter", group: "tool", aliases: ["jupyter", "jupyter notebook"] },
  { term: "Matplotlib", group: "tool", aliases: ["matplotlib", "seaborn", "plotly"] },

  // Databases & data engineering
  { term: "PostgreSQL", group: "tool", aliases: ["postgresql", "postgres"] },
  { term: "MySQL", group: "tool", aliases: ["mysql"] },
  { term: "SQL Server", group: "tool", aliases: ["sql server", "mssql", "t-sql", "tsql"] },
  { term: "Oracle", group: "tool", aliases: ["oracle"] },
  { term: "SQLite", group: "tool", aliases: ["sqlite"] },
  { term: "NoSQL", group: "tool", aliases: ["nosql", "mongodb"] },
  { term: "Databases", group: "concept", aliases: ["database", "databases", "rdbms", "قواعد البيانات", "قاعدة بيانات"] },
  { term: "ETL", group: "concept", aliases: ["etl", "elt", "data pipeline", "data pipelines"] },
  { term: "Data Warehouse", group: "concept", aliases: ["data warehouse", "data warehousing", "dwh"] },
  { term: "Data Modeling", group: "concept", aliases: ["data modeling", "data modelling"] },
  { term: "Spark", group: "tool", aliases: ["spark", "pyspark", "apache spark"] },
  { term: "Hadoop", group: "tool", aliases: ["hadoop", "hive"] },
  { term: "Airflow", group: "tool", aliases: ["airflow"] },
  { term: "dbt", group: "tool", aliases: ["dbt"] },
  { term: "Snowflake", group: "tool", aliases: ["snowflake"] },
  { term: "Kafka", group: "tool", aliases: ["kafka"] },
  { term: "Big Data", group: "concept", aliases: ["big data", "البيانات الضخمة"] },

  // Cloud & engineering
  { term: "AWS", group: "tool", aliases: ["aws", "amazon web services"] },
  { term: "Azure", group: "tool", aliases: ["azure"] },
  { term: "GCP", group: "tool", aliases: ["gcp", "google cloud", "bigquery"] },
  { term: "Cloud", group: "concept", aliases: ["cloud", "cloud computing", "الحوسبة السحابية"] },
  { term: "Docker", group: "tool", aliases: ["docker", "containers"] },
  { term: "Git", group: "tool", aliases: ["git", "github", "gitlab", "version control"] },
  { term: "Linux", group: "tool", aliases: ["linux", "unix"] },
  { term: "APIs", group: "concept", aliases: ["api", "apis", "rest api", "rest apis"] },
  { term: "Node.js", group: "tool", aliases: ["node.js", "nodejs", "node"] },
  { term: "Networking", group: "concept", aliases: ["networking", "network", "networks", "الشبكات"] },

  // Analysis & ML concepts
  { term: "Data Analysis", group: "concept", aliases: ["data analysis", "data analytics", "analytics", "تحليل البيانات"] },
  { term: "Data Visualization", group: "concept", aliases: ["data visualization", "data visualisation", "visualization", "visualisation", "تصور البيانات"] },
  { term: "Dashboards", group: "concept", aliases: ["dashboard", "dashboards", "لوحات المعلومات", "لوحة المعلومات"] },
  { term: "Reporting", group: "concept", aliases: ["reporting", "reports", "التقارير"] },
  { term: "KPIs", group: "concept", aliases: ["kpi", "kpis", "مؤشرات الأداء"] },
  { term: "Data Cleaning", group: "concept", aliases: ["data cleaning", "data cleansing", "data wrangling", "data preparation"] },
  { term: "Statistics", group: "concept", aliases: ["statistics", "statistical", "الإحصاء", "الاحصاء"] },
  { term: "A/B Testing", group: "concept", aliases: ["a/b testing", "ab testing", "experimentation", "hypothesis testing"] },
  { term: "Machine Learning", group: "concept", aliases: ["machine learning", "ml", "تعلم الآلة"] },
  { term: "Deep Learning", group: "concept", aliases: ["deep learning", "neural networks", "التعلم العميق"] },
  { term: "Computer Vision", group: "concept", aliases: ["computer vision", "object detection", "image classification", "yolo", "yolov8"] },
  { term: "NLP", group: "concept", aliases: ["nlp", "natural language processing"] },
  { term: "Generative AI", group: "concept", aliases: ["generative ai", "genai", "llm", "llms", "large language models"] },
  { term: "AI", group: "concept", aliases: ["ai", "artificial intelligence", "الذكاء الاصطناعي", "ذكاء اصطناعي"] },
  { term: "Predictive Modeling", group: "concept", aliases: ["predictive modeling", "predictive modelling", "predictive analytics", "regression", "classification", "random forest", "knn"] },
  { term: "Time Series", group: "concept", aliases: ["time series", "forecasting", "sarima", "arima"] },
  { term: "Data Mining", group: "concept", aliases: ["data mining"] },
  { term: "Automation", group: "concept", aliases: ["automation", "automate", "automated", "الأتمتة", "أتمتة"] },
  { term: "Financial Modeling", group: "concept", aliases: ["financial modeling", "financial modelling", "financial analysis", "npv", "irr"] },
  { term: "Data Governance", group: "concept", aliases: ["data governance", "data quality", "حوكمة البيانات"] },
  { term: "Web Analytics", group: "concept", aliases: ["web analytics", "google analytics", "google tag manager", "utm"] },
];

// ---------- Matching ----------

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Build one regex per dictionary entry (whole-word, case-insensitive, works for Arabic too).
// Arabic words often carry attached prefixes: ال (the), و (and), ب/ل/ك (with/for/like).
// e.g. "الإكسل", "وبايثون", "بالبيانات" — allow them before Arabic aliases.
const ARABIC = /\p{Script=Arabic}/u;
const ARABIC_PREFIX = "(?:و?[بلك]?(?:ال)?)?";

const COMPILED = DICTIONARY.map((entry) => {
  if (entry.pattern) return { ...entry, regex: new RegExp(entry.pattern.source, entry.pattern.flags.replace("g", "") + "g") };
  const parts = entry.aliases.map((a) => {
    const body = escape(a).replace(/\s+/g, "[\\s\\-]*");
    return ARABIC.test(a) ? ARABIC_PREFIX + body : body;
  });
  const source = `(?<![\\p{L}\\p{N}_])(?:${parts.join("|")})(?![\\p{L}\\p{N}_])`;
  return { ...entry, regex: new RegExp(source, "giu") };
});

/** Which dictionary terms appear in a text, and how many times. Returns Map(term -> count). */
export function findTerms(text) {
  const found = new Map();
  if (!text) return found;
  for (const entry of COMPILED) {
    const hits = text.match(entry.regex);
    if (hits) found.set(entry.term, hits.length);
  }
  return found;
}

/** Turn the profile into searchable chunks, each tagged with the id it came from. */
function profileChunks(profile) {
  const chunks = [];
  if (profile.skills) {
    chunks.push({ id: "skills", text: Object.values(profile.skills).flat().join(" · ") });
  }
  for (const section of ["experience", "projects", "education", "certifications"]) {
    for (const item of profile[section] || []) {
      const text = [
        item.title, item.company, item.name, item.degree, item.issuer,
        ...(item.bullets || []), ...(item.skills || []),
      ].filter(Boolean).join(" · ");
      chunks.push({ id: item.id, text });
    }
  }
  return chunks;
}

/**
 * Compare a job ad with a profile.
 * Returns { score, matched: [{term, weight, evidence:[ids]}], missing: [{term, weight}], total_terms }
 */
export function matchJob(jobText, profile) {
  const jobTerms = findTerms(jobText);

  // term -> list of profile ids that mention it
  const evidence = new Map();
  for (const chunk of profileChunks(profile)) {
    for (const term of findTerms(chunk.text).keys()) {
      if (!evidence.has(term)) evidence.set(term, []);
      evidence.get(term).push(chunk.id);
    }
  }

  const matched = [];
  const missing = [];
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const [term, count] of jobTerms) {
    const weight = count >= 2 ? 2 : 1;
    totalWeight += weight;
    if (evidence.has(term)) {
      matchedWeight += weight;
      matched.push({ term, weight, evidence: evidence.get(term) });
    } else {
      missing.push({ term, weight });
    }
  }

  // Most important first
  const byWeight = (a, b) => b.weight - a.weight || a.term.localeCompare(b.term);
  matched.sort(byWeight);
  missing.sort(byWeight);

  const score = totalWeight ? Math.round((100 * matchedWeight) / totalWeight) : 0;
  return { score, matched, missing, total_terms: jobTerms.size };
}
