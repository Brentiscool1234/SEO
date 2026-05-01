import { NextRequest } from "next/server";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const maxDuration = 300;

type SSEEvent = {
  step: "crawl" | "audit" | "report" | "pdf" | "done" | "error";
  type: "start" | "progress" | "done" | "error";
  message: string;
  detail?: string;
  data?: Record<string, unknown>;
};

function encoder() {
  const e = new TextEncoder();
  return (event: SSEEvent) => e.encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ── Firecrawl ──────────────────────────────────────────────────────────────

interface FirecrawlPage {
  url: string;
  title?: string;
  description?: string;
  statusCode?: number;
}

// Firecrawl v1 raw response shape — data lives under metadata
interface FirecrawlRawPage {
  url?: string;
  title?: string;
  description?: string;
  statusCode?: number;
  metadata?: {
    sourceURL?: string;
    title?: string;
    description?: string;
    statusCode?: number;
  };
}

function normalisePage(p: FirecrawlRawPage): FirecrawlPage {
  return {
    url:         p.metadata?.sourceURL ?? p.url ?? "",
    title:       p.metadata?.title       ?? p.title       ?? "",
    description: p.metadata?.description ?? p.description ?? "",
    statusCode:  p.metadata?.statusCode  ?? p.statusCode  ?? 200,
  };
}

async function crawlSite(
  baseUrl: string,
  apiKey: string,
  emit: (e: SSEEvent) => void
): Promise<FirecrawlPage[]> {
  emit({ step: "crawl", type: "progress", message: `Submitting crawl job`, detail: baseUrl });

  let start;
  try {
    start = await axios.post(
      "https://api.firecrawl.dev/v1/crawl",
      { url: baseUrl, limit: 50, scrapeOptions: { formats: ["markdown"] } },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body = err.response?.data;
      const bodyMsg = typeof body === "object" ? (body?.error ?? body?.message ?? JSON.stringify(body)) : body;
      throw new Error(`Firecrawl HTTP ${status}: ${bodyMsg}`);
    }
    throw err;
  }

  const jobId: string = start.data.id;
  emit({ step: "crawl", type: "progress", message: `Job started`, detail: `ID: ${jobId}` });

  let lastCount = 0;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await axios.get(
      `https://api.firecrawl.dev/v1/crawl/${jobId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    const rawPages: FirecrawlRawPage[] = res.data.data || [];
    const pages = rawPages.map(normalisePage).filter(p => p.url);
    if (pages.length !== lastCount) {
      lastCount = pages.length;
      const latest = pages[pages.length - 1];
      emit({
        step: "crawl",
        type: "progress",
        message: `${pages.length} page${pages.length !== 1 ? "s" : ""} found`,
        detail: latest?.url,
      });
    }

    if (res.data.status === "completed") return pages;
    if (res.data.status === "failed") throw new Error("Firecrawl job failed");
  }
  throw new Error("Crawl timed out after 5 minutes");
}

// ── DataForSEO ─────────────────────────────────────────────────────────────

interface DFSPageItem {
  url?: string;
  onpage_score?: number;
  meta?: {
    title?: string;
    description?: string;
    htags?: Record<string, string[]>;
    images_count?: number;
    images_without_alt_count?: number;
    internal_links_count?: number;
    external_links_count?: number;
    content?: { plain_text_word_count?: number };
  };
  page_timing?: { time_to_interactive?: number };
  checks?: Record<string, unknown>;
}

export interface PageAuditData {
  url: string;
  score: number;
  title: string;
  description: string;
  h1Count: number;
  wordCount: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  loadTimeMs: number;
  statusCode: number;
  checks: Record<string, unknown>;
}


function sanitizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    // DataForSEO only accepts http/https pages
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Strip fragments — #section anchors are not real pages
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

async function auditPage(
  page: FirecrawlPage,
  auth: string,
): Promise<PageAuditData> {
  const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };

  let postRes;
  try {
    postRes = await axios.post(
      "https://api.dataforseo.com/v3/on_page/instant_pages",
      [{ url: page.url }],
      { headers }
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body = err.response?.data;
      // Extract message from body, fall back to full JSON so nothing is hidden
      const bodyMsg = typeof body === "object"
        ? (body?.status_message ?? body?.message ?? JSON.stringify(body))
        : String(body ?? "no response body");
      throw new Error(`HTTP ${status}: ${bodyMsg}`);
    }
    throw err;
  }

  // Check top-level response status
  const topCode = postRes.data?.status_code;
  if (topCode && topCode !== 20000) {
    throw new Error(`DataForSEO: ${postRes.data?.status_message ?? topCode}`);
  }

  const task = postRes.data?.tasks?.[0];
  if (!task) throw new Error("DataForSEO returned no task in response");

  // Check task-level status — this is where per-request errors appear
  const taskCode = task?.status_code;
  if (taskCode && taskCode !== 20000) {
    // Include the full task status so we can diagnose unexpected errors
    throw new Error(`DataForSEO task error ${taskCode}: ${task?.status_message ?? "no message"}`);
  }

  const item: DFSPageItem = task?.result?.[0]?.items?.[0] ?? {};
  const score = Math.round((item.onpage_score ?? 0) * 100) / 100;

  return {
    url: page.url,
    score,
    title: item.meta?.title ?? page.title ?? "",
    description: item.meta?.description ?? page.description ?? "",
    h1Count: (item.meta?.htags?.h1 ?? []).length,
    wordCount: item.meta?.content?.plain_text_word_count ?? 0,
    imagesTotal: item.meta?.images_count ?? 0,
    imagesMissingAlt: item.meta?.images_without_alt_count ?? 0,
    internalLinks: item.meta?.internal_links_count ?? 0,
    externalLinks: item.meta?.external_links_count ?? 0,
    loadTimeMs: Math.round((item.page_timing?.time_to_interactive ?? 0) * 1000),
    statusCode: page.statusCode ?? 200,
    checks: item.checks ?? {},
  };
}

async function auditPages(
  pages: FirecrawlPage[],
  login: string,
  password: string,
  emit: (e: SSEEvent) => void
): Promise<PageAuditData[]> {
  const auth = Buffer.from(`${login}:${password}`).toString("base64");
  const results: PageAuditData[] = [];

  // Sanitize and deduplicate before sending anything to DataForSEO
  const seen = new Set<string>();
  const clean: FirecrawlPage[] = [];
  for (const page of pages) {
    const url = sanitizeUrl(page.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    clean.push({ ...page, url });
  }

  const skipped = pages.length - clean.length;
  if (skipped > 0) {
    emit({ step: "audit", type: "progress", message: `Skipped ${skipped} invalid/duplicate URLs`, detail: "fragments, non-http, or duplicates removed" });
  }

  for (let i = 0; i < clean.length; i++) {
    const page = clean[i];
    emit({ step: "audit", type: "progress", message: `Auditing ${i + 1} / ${clean.length}`, detail: page.url });

    try {
      const result = await auditPage(page, auth);
      emit({ step: "audit", type: "progress", message: `Score: ${result.score}/100`, detail: page.url });
      results.push(result);
    } catch (err: unknown) {
      // Log the failure but keep going — one bad URL shouldn't stop the audit
      const msg = err instanceof Error ? err.message : "Unknown error";
      emit({ step: "audit", type: "progress", message: `Skipped (error)`, detail: `${page.url} — ${msg}` });
    }
  }

  if (results.length === 0) throw new Error("All pages failed to audit. Check your DataForSEO credentials.");
  return results;
}

// ── Claude report ──────────────────────────────────────────────────────────

function buildPrompt(urls: string[], auditData: PageAuditData[]): string {
  const avgScore = auditData.reduce((s, p) => s + p.score, 0) / auditData.length;
  const critical = auditData.filter(p => p.score < 40);
  const warnings = auditData.filter(p => p.score >= 40 && p.score < 70);
  const good     = auditData.filter(p => p.score >= 70);

  const missingTitles = auditData.filter(p => !p.title);
  const missingDesc   = auditData.filter(p => !p.description);
  const noH1          = auditData.filter(p => p.h1Count === 0);
  const slowPages     = auditData.filter(p => p.loadTimeMs > 3000);
  const brokenPages   = auditData.filter(p => p.statusCode >= 400);
  const missingAlt    = auditData.filter(p => p.imagesMissingAlt > 0);

  const urlList = (pages: PageAuditData[]) => pages.map(p => `    - ${p.url}`).join("\n") || "    (none)";

  const worst = [...auditData].sort((a, b) => a.score - b.score).slice(0, 10);
  const worstList = worst.map(p =>
    `  - ${p.url} | Score: ${p.score} | Load: ${p.loadTimeMs}ms | H1s: ${p.h1Count} | Title: "${p.title || "MISSING"}" | Desc: ${p.description ? "yes" : "MISSING"}`
  );

  return `You are a senior SEO consultant delivering a paid audit report to a client. Generate a complete, professional HTML+CSS report. Do NOT mention AI, Claude, machine learning, or any automated tool anywhere in the report — it should read as if written by a human consultant.

AUDIT DATA:
- Sites audited: ${urls.join(", ")}
- Total pages: ${auditData.length}
- Average SEO score: ${avgScore.toFixed(1)}/100
- Critical pages (score < 40): ${critical.length}
- Warning pages (score 40–70): ${warnings.length}
- Good pages (score ≥ 70): ${good.length}

PAGES WITH MISSING TITLE TAGS (${missingTitles.length}):
${urlList(missingTitles)}

PAGES WITH MISSING META DESCRIPTIONS (${missingDesc.length}):
${urlList(missingDesc)}

PAGES MISSING H1 TAG (${noH1.length}):
${urlList(noH1)}

SLOW PAGES >3s (${slowPages.length}):
${slowPages.map(p => `    - ${p.url} (${p.loadTimeMs}ms)`).join("\n") || "    (none)"}

BROKEN PAGES 4xx/5xx (${brokenPages.length}):
${brokenPages.map(p => `    - ${p.url} (${p.statusCode})`).join("\n") || "    (none)"}

PAGES WITH MISSING IMAGE ALT TEXT (${missingAlt.length}):
${missingAlt.map(p => `    - ${p.url} (${p.imagesMissingAlt} missing)`).join("\n") || "    (none)"}

WORST PERFORMING PAGES:
${worstList.join("\n")}

ALL PAGE DATA (JSON):
${JSON.stringify(auditData, null, 2)}

REPORT STRUCTURE — include ALL of these sections in order:

1. HEADER
   - Agency-style header with report title "SEO Audit Report", date, and domains audited

2. EXECUTIVE SUMMARY (stat cards)
   - Large bold cards: Total Pages, Avg Score, Critical Issues, Good Pages

3. WHAT HAS TO HAPPEN — THIS IS THE MOST IMPORTANT SECTION
   Title this section "What Has to Happen" in the report.
   Write 3–5 paragraphs as a senior SEO consultant speaking directly to the client.
   - Start with an honest overall assessment (is the site in good, average, or poor SEO health?)
   - Identify the top 3 patterns/issues you see across the data — be specific, name actual URLs where relevant
   - Explain WHY each issue hurts them (rankings, click-through rate, user experience, crawlability)
   - Give clear, jargon-free language a non-technical client can understand
   - End with a prioritised "What to work on first" paragraph — most impactful quick wins first
   - Tone: confident, helpful, not alarmist. Like a consultant who genuinely wants them to succeed.

4. ISSUE BREAKDOWN — one section per issue category, each must list EVERY affected page URL
   For each of these categories: Missing Title Tags, Missing Meta Descriptions, Missing H1, Slow Pages, Broken Pages, Missing Alt Text:
   - Show the severity badge (Critical / High Priority / Warning)
   - Write 1–2 sentences explaining the impact
   - List EVERY affected URL from the data above — do not summarise or truncate, show all of them
   - If a category has 0 affected pages, show a green "All good" state instead

5. PRIORITISED ACTION PLAN
   - Numbered list of the top 5 fixes, each with:
     * Issue name + severity
     * Plain-English explanation
     * Why it matters for SEO
     * Exact action to take
     * Estimated effort (Low / Medium / High)

6. PAGE-BY-PAGE TABLE
   - All pages with columns: URL, Score (color-coded), Title, H1 count, Load Time, Status
   - Red rows for score < 40, amber for 40–70, green for ≥ 70

7. FOOTER
   - "SEO Audit Report" + date. No mention of AI, Claude, or any tool name.

DESIGN REQUIREMENTS:
- Clean light theme: white/zinc-50 background, zinc-900 text, violet #7c3aed accent
- Use color sparingly: red #ef4444 for critical, amber #f59e0b for warnings, emerald #10b981 for good
- Google Fonts @import for Inter
- Inline CSS only — fully self-contained, no external dependencies
- Premium agency feel: generous whitespace, clear hierarchy, subtle shadows
- The "What Has to Happen" section should feel like editorial writing — slightly larger font, generous line height, subtle left border accent

Return ONLY the complete HTML document starting with <!DOCTYPE html>. No markdown, no explanation.`;
}

// ── PDF ────────────────────────────────────────────────────────────────────

async function generatePDF(html: string, auditId: string): Promise<string> {
  const reportsDir = path.join(process.cwd(), "public", "reports");
  await mkdir(reportsDir, { recursive: true });
  const fileName = `${auditId}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
  const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  await browser.close();
  await writeFile(filePath, pdfBuffer);
  return `/reports/${fileName}`;
}

// ── Main SSE handler ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { urls, keys, auditId, mode } = await req.json();
  const auditOnly = mode === "audit-only";

  const stream = new ReadableStream({
    async start(controller) {
      const encode = encoder();
      const emit = (event: SSEEvent) => {
        try { controller.enqueue(encode(event)); } catch {}
      };

      try {
        let allPages: FirecrawlPage[];

        if (auditOnly) {
          // ── Skip crawl — use provided URLs directly ──
          emit({ step: "crawl", type: "start", message: "Skipping crawl — using provided page URLs" });
          allPages = urls.map((url: string) => ({ url, title: "", description: "", statusCode: 200 }));
        } else {
          // ── Step 1: Crawl ──
          emit({ step: "crawl", type: "start", message: `Crawling ${urls.length} site(s)...` });
          allPages = [];
          for (const url of urls) {
            emit({ step: "crawl", type: "progress", message: "Starting crawl", detail: url });
            const pages = await crawlSite(url, keys.firecrawl, emit);
            allPages.push(...pages);
          }
        }

        // Write crawled URLs to a txt file immediately so the client can download/copy
        const reportsDir = path.join(process.cwd(), "public", "reports");
        await mkdir(reportsDir, { recursive: true });
        const urlsTxtPath = path.join(reportsDir, `${auditId}-urls.txt`);
        await writeFile(urlsTxtPath, allPages.map(p => p.url).join("\n"), "utf-8");
        const urlsFileUrl = `/reports/${auditId}-urls.txt`;

        emit({
          step: "crawl",
          type: "done",
          message: `Found ${allPages.length} page${allPages.length !== 1 ? "s" : ""}`,
          data: { urlsFileUrl },
        });

        // ── Step 2: Audit ──
        emit({ step: "audit", type: "start", message: `Auditing ${allPages.length} pages with DataForSEO...` });
        const auditData = await auditPages(allPages, keys.dataforseo_login, keys.dataforseo_password, emit);
        const avgScore = (auditData.reduce((s, p) => s + p.score, 0) / auditData.length).toFixed(1);
        emit({ step: "audit", type: "done", message: `Audited ${auditData.length} pages — avg score ${avgScore}/100` });

        // ── Step 3: Report ──
        emit({ step: "report", type: "start", message: "Sending data to Claude..." });
        emit({ step: "report", type: "progress", message: `${auditData.length} pages of data → claude-sonnet-4-6`, detail: "Designing report layout..." });

        const client = new Anthropic({ apiKey: keys.anthropic });
        const msg = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [{ role: "user", content: buildPrompt(urls, auditData) }],
        });
        const html = (msg.content[0] as { text: string }).text.trim();
        if (!html.startsWith("<!DOCTYPE")) throw new Error("Claude returned unexpected content");
        emit({ step: "report", type: "done", message: "Report designed successfully" });

        // ── Step 4: PDF ──
        emit({ step: "pdf", type: "start", message: "Launching headless browser..." });
        emit({ step: "pdf", type: "progress", message: "Rendering HTML to PDF...", detail: "Printing A4 pages..." });
        const downloadUrl = await generatePDF(html, auditId);
        emit({ step: "pdf", type: "done", message: "PDF ready", data: { downloadUrl } });

        emit({ step: "done", type: "done", message: "Audit complete", data: { downloadUrl, pageCount: allPages.length } });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        emit({ step: "error", type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
