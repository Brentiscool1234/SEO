# SEO Audit Tool

Automated SEO audits powered by Firecrawl, DataForSEO, and Claude. Enter URLs, get a professional PDF report.

## Setup (2 minutes)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## First Time

1. Click **Settings** in the top right
2. Enter your API keys:
   - **Firecrawl** — [firecrawl.dev](https://firecrawl.dev)
   - **DataForSEO** login + password — [dataforseo.com](https://dataforseo.com)
   - **Anthropic** — [console.anthropic.com](https://console.anthropic.com)
3. Click **Save Keys**

## Running an Audit

1. Paste one or more URLs on the dashboard
2. Click **Run Audit**
3. Watch the 4-step progress: Crawl → Audit → Report → PDF
4. Download the PDF when done

## What It Does

| Step | API | What happens |
|---|---|---|
| Crawl | Firecrawl | Discovers all pages on each domain (up to 50) |
| Audit | DataForSEO On-Page | Checks titles, meta, H1s, load time, links, score |
| Report | Claude (claude-sonnet-4-6) | Designs a styled HTML report from the data |
| PDF | Puppeteer | Renders the HTML to a print-ready PDF |

## Requirements

- Node.js 18+
- API keys for Firecrawl, DataForSEO, and Anthropic
