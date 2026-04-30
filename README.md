# SEO Audit Tool

Automated SEO audits powered by Firecrawl, DataForSEO, and Claude. Enter URLs, get a professional PDF report.

## Running the App

**Windows** — double-click `run.bat`

**Mac / Linux** — run in terminal:
```bash
chmod +x run.sh && ./run.sh
```

That's it. On first run it installs Node.js (Windows only, via winget) and dependencies automatically. After that it's instant.

---

## First Time Setup

1. The app opens at **http://localhost:3000**
2. Click **Settings** (top right)
3. Enter your API keys:
   - **Firecrawl** — [firecrawl.dev](https://firecrawl.dev)
   - **DataForSEO** login + password — [dataforseo.com](https://dataforseo.com)
   - **Anthropic** — [console.anthropic.com](https://console.anthropic.com)
4. Click **Save Keys** — keys are stored locally, never sent anywhere else

---

## Running an Audit

1. Paste one or more URLs on the dashboard
2. Click **Run Audit**
3. Watch 4-step progress: Crawl → Audit → Report → PDF
4. Download the PDF when done

---

## How It Works

| Step | API | What happens |
|---|---|---|
| Crawl | Firecrawl | Discovers all pages on the domain (up to 50) |
| Audit | DataForSEO On-Page | Scores each page — titles, meta, H1s, load time, links |
| Report | Claude (claude-sonnet-4-6) | Designs a polished HTML report from the audit data |
| PDF | Puppeteer | Renders it to a print-ready PDF |
