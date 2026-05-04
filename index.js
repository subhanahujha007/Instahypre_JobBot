require('dotenv').config();
const fs = require('fs');
const { chromium } = require('playwright');

const APPLIED_FILE = 'applied.json';

function buildSearchUrl() {
  const params = new URLSearchParams({
    company_size: process.env.COMPANY_SIZE || '0',
    job_type: process.env.JOB_TYPE || '0',
    skills: process.env.SKILLS || 'React.js',
    source: process.env.SOURCE || 'opportunities',
    status: process.env.STATUS || '0',
    years: process.env.YEARS || '2',
  });

  return `/api/v1/job_search?${params.toString()}`;
}

function loadApplied() {
  if (!fs.existsSync(APPLIED_FILE)) return [];
  return JSON.parse(fs.readFileSync(APPLIED_FILE));
}

function saveApplied(applied) {
  fs.writeFileSync(APPLIED_FILE, JSON.stringify(applied, null, 2));
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // 🔐 Login
  await page.goto('https://www.instahyre.com/login');
  await page.fill('input[name="email"]', process.env.EMAIL);
  await page.fill('input[name="password"]', process.env.PASSWORD);
  await page.click('button[type="submit"]');

  // Stable wait (don’t use waitForURL)
  await page.waitForSelector('text=Opportunities', { timeout: 20000 });
  console.log("✅ Logged in");

  // 🔎 Build dynamic API URL
  const apiUrl = buildSearchUrl();
  console.log("🔎 Using API:", apiUrl);

  // 📥 Fetch jobs
  const jobs = await page.evaluate(async (url) => {
    const res = await fetch(url, {
      headers: { "accept": "application/json" },
      credentials: "include"
    });
    return res.json();
  }, apiUrl);

  // 🧠 Normalize Instahyre’s inconsistent response
  const jobList =
    jobs.objects ||
    jobs.results ||
    jobs.paginatedList ||
    jobs.data?.objects ||
    jobs.data?.results ||
    [];

  console.log("✅ Jobs fetched:", jobList.length);

  const applied = loadApplied();

  // 🚀 Apply loop
  for (const job of jobList) {
    if (applied.includes(job.id)) {
      console.log("⏭️ Already applied:", job.title);
      continue;
    }

    console.log(`🚀 Applying to: ${job.title} | ID: ${job.id}`);

    const result = await page.evaluate(async (jobId) => {
      const csrftoken = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='))
        ?.split('=')[1];

      const res = await fetch(
        "/api/v1/candidate_opportunities/candidate_opportunity/apply",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": csrftoken,
            "Accept": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            id: null,
            is_activity_page_job: false,
            is_interested: true,
            job_id: jobId
          })
        }
      );

      return res.json();
    }, job.id);

    console.log("✅", result.message);

    applied.push(job.id);
    saveApplied(applied);

    await page.waitForTimeout(2000); // human-like delay
  }

  console.log("🎉 Done applying!");
  await browser.close();
})();