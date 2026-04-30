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

    const pages: FirecrawlPage[] = res.data.data || [];
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

    if (res.data.status === "completed") {
      return pages.map(p => ({
        url: p.url,
        title: p.title || "",
        description: p.description || "",
        statusCode: p.statusCode || 200,
      }));
    }
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

function dfsError(data: Record<string, unknown>): string | null {
  // DataForSEO often returns HTTP 200 with an error code in the body
  const code = data?.status_code as number | undefined;
  const msg = data?.status_message as string | undefined;
  if (code && code !== 20000) return `DataForSEO error ${code}: ${msg ?? "unknown"}`;
  return null;
}

async function auditPage(
  page: FirecrawlPage,
  auth: string,
): Promise<PageAuditData> {
  const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };

  let postRes;
  try {
    // instant_pages accepts exactly 1 task per request
    postRes = await axios.post(
      "https://api.dataforseo.com/v3/on_page/instant_pages",
      [{ url: page.url, load_resources: false, enable_javascript: false }],
      { headers }
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body = err.response?.data;
      const bodyMsg = typeof body === "object" ? (body?.status_message ?? JSON.stringify(body)) : body;
      throw new Error(`DataForSEO HTTP ${status}: ${bodyMsg}`);
    }
    throw err;
  }

  const topLevel = dfsError(postRes.data);
  if (topLevel) throw new Error(topLevel);

  const task = postRes.data?.tasks?.[0];
  const taskErr = dfsError(task);
  if (taskErr) throw new Error(taskErr);

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

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    emit({ step: "audit", type: "progress", message: `Auditing ${i + 1} / ${pages.length}`, detail: page.url });

    const result = await auditPage(page, auth);
    emit({ step: "audit", type: "progress", message: `Score: ${result.score}/100`, detail: page.url });
    results.push(result);
  }
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

  const worst = [...auditData].sort((a, b) => a.score - b.score).slice(0, 10);
  const worstList = worst.map(p =>
    `  - ${p.url} | Score: ${p.score} | Load: ${p.loadTimeMs}ms | H1s: ${p.h1Count} | Title: "${p.title || "MISSING"}" | Desc: ${p.description ? "yes" : "MISSING"}`
  );

  return `You are a senior SEO consultant delivering a paid audit report to a client. Generate a complete, professional HTML+CSS report.

AUDIT DATA:
- Sites audited: ${urls.join(", ")}
- Total pages: ${auditData.length}
- Average SEO score: ${avgScore.toFixed(1)}/100
- Critical pages (score < 40): ${critical.length}
- Warning pages (score 40–70): ${warnings.length}
- Good pages (score ≥ 70): ${good.length}
- Missing title tags: ${missingTitles.length} pages
- Missing meta descriptions: ${missingDesc.length} pages
- Pages with no H1: ${noH1.length}
- Slow pages (>3s load time): ${slowPages.length}
- Broken pages (4xx/5xx): ${brokenPages.length}
- Pages with missing image alt text: ${missingAlt.length}

WORST PERFORMING PAGES:
${worstList.join("\n")}

ALL PAGE DATA (JSON):
${JSON.stringify(auditData.slice(0, 30), null, 2)}

REPORT STRUCTURE — include ALL of these sections in order:

1. HEADER
   - Agency-style header with report title "SEO Audit Report", date, and domains audited

2. EXECUTIVE SUMMARY (stat cards)
   - Large bold cards: Total Pages, Avg Score, Critical Issues, Good Pages

3. AI CONSULTANT ANALYSIS — THIS IS THE MOST IMPORTANT SECTION
   Write 3–5 paragraphs as a senior SEO consultant speaking directly to the client.
   - Start with an honest overall assessment (is the site in good, average, or poor SEO health?)
   - Identify the top 3 patterns/issues you see across the data — be specific, name actual URLs where relevant
   - Explain WHY each issue hurts them (rankings, click-through rate, user experience, crawlability)
   - Give clear, jargon-free language a non-technical client can understand
   - End with a prioritised "What to fix first" paragraph — most impactful quick wins first
   - Tone: confident, helpful, not alarmist. Like a consultant who genuinely wants them to succeed.

4. ISSUE BREAKDOWN (visual)
   - Score distribution bar chart (CSS only)
   - Cards for each issue category: Missing Titles, Missing Descriptions, No H1, Slow Pages, Broken Pages, Missing Alt Text
   - Each card shows count, severity badge, and a one-sentence explanation of the impact

5. PRIORITISED ACTION PLAN
   - Numbered list of the top 5 fixes, each with:
     * Issue name + severity (Critical / Warning / Opportunity)
     * Plain-English explanation of what it is
     * Why it matters for SEO
     * Exact action to take
     * Estimated effort (Low / Medium / High)

6. PAGE-BY-PAGE TABLE
   - All pages with columns: URL, Score (color-coded), Title, H1 count, Load Time, Status
   - Red rows for score < 40, amber for 40–70, green for ≥ 70

7. FOOTER
   - "Generated by SEO Audit Tool · Powered by Claude" + date

DESIGN REQUIREMENTS:
- Clean light theme: white/zinc-50 background, zinc-900 text, violet #7c3aed accent
- Use color sparingly: red #ef4444 for critical, amber #f59e0b for warnings, emerald #10b981 for good
- Google Fonts @import for Inter
- Inline CSS only — fully self-contained, no external dependencies
- Premium agency feel: generous whitespace, clear hierarchy, subtle shadows
- The AI Analysis section should feel like editorial writing — use a slightly larger font, generous line height, maybe a subtle left border accent

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
          emit({ step: "crawl", type: "done", message: `Using ${allPages.length} provided page URL(s)` });
        } else {
          // ── Step 1: Crawl ──
          emit({ step: "crawl", type: "start", message: `Crawling ${urls.length} site(s)...` });
          allPages = [];
          for (const url of urls) {
            emit({ step: "crawl", type: "progress", message: "Starting crawl", detail: url });
            const pages = await crawlSite(url, keys.firecrawl, emit);
            allPages.push(...pages);
          }
          emit({ step: "crawl", type: "done", message: `Found ${allPages.length} pages across ${urls.length} site(s)` });
        }

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
