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
  const context = await browser.newContext();
  const page = await context.newPage();

  await context.clearCookies();

  // Login
  await page.goto('https://www.instahyre.com/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', process.env.EMAIL);
  await page.fill('input[name="password"]', process.env.PASSWORD);

  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForLoadState('networkidle')
  ]);

  await page.goto('https://www.instahyre.com/candidate/opportunities/', {
    waitUntil: 'domcontentloaded'
  });

  await page.waitForTimeout(4000);
  console.log("✅ Logged in");

  // Fetch jobs
  const apiUrl = buildSearchUrl();
  console.log("🔎 Using API:", apiUrl);

  const jobs = await page.evaluate(async (url) => {
    const res = await fetch(url, {
      headers: { "accept": "application/json" },
      credentials: "include"
    });
    return res.json();
  }, apiUrl);

  const jobList =
    jobs.objects ||
    jobs.results ||
    jobs.paginatedList ||
    jobs.data?.objects ||
    jobs.data?.results ||
    [];

  console.log("✅ Jobs fetched:", jobList.length);

  const applied = loadApplied();

  // Apply loop
  for (const job of jobList) {
    if (applied.includes(job.id)) {
      console.log("⏭️ Skipped (already handled):", job.title);
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

    // ✅ Correct handling
    if (result.success || result.message?.toLowerCase().includes("already")) {
      console.log(`✅ Applied/Already: ${job.title}`);
      applied.push(job.id);
      saveApplied(applied);
    } else {
      console.log(`❌ Failed: ${job.title}`, result);
    }

    await page.waitForTimeout(2000);
  }

  console.log("🎉 Done applying!");
  await browser.close();
})();