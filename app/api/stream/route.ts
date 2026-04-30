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

  const start = await axios.post(
    "https://api.firecrawl.dev/v1/crawl",
    { url: baseUrl, limit: 50, scrapeOptions: { formats: ["markdown"] } },
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

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

async function auditPages(
  pages: FirecrawlPage[],
  login: string,
  password: string,
  emit: (e: SSEEvent) => void
): Promise<PageAuditData[]> {
  const auth = Buffer.from(`${login}:${password}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
  const results: PageAuditData[] = [];
  const BATCH = 5;

  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);

    batch.forEach((p, j) => {
      emit({
        step: "audit",
        type: "progress",
        message: `Auditing ${i + j + 1} / ${pages.length}`,
        detail: p.url,
      });
    });

    const postRes = await axios.post(
      "https://api.dataforseo.com/v3/on_page/instant_pages",
      batch.map(p => ({ url: p.url })),
      { headers }
    );

    const taskResults = postRes.data?.tasks || [];
    for (let j = 0; j < batch.length; j++) {
      const items = taskResults[j]?.result?.[0]?.items as DFSPageItem[] | undefined;
      const item: DFSPageItem = items?.[0] ?? {};
      const page = batch[j];
      const score = Math.round((item.onpage_score ?? 0) * 100) / 100;

      emit({
        step: "audit",
        type: "progress",
        message: `Score: ${score}/100`,
        detail: page.url,
      });

      results.push({
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
      });
    }
  }
  return results;
}

// ── Claude report ──────────────────────────────────────────────────────────

function buildPrompt(urls: string[], auditData: PageAuditData[]): string {
  const avgScore = auditData.reduce((s, p) => s + p.score, 0) / auditData.length;
  const critical = auditData.filter(p => p.score < 40).length;
  const warnings = auditData.filter(p => p.score >= 40 && p.score < 70).length;
  const good = auditData.filter(p => p.score >= 70).length;

  const topIssues = [...auditData]
    .sort((a, b) => a.score - b.score)
    .slice(0, 10)
    .map(p => `  - ${p.url} | Score: ${p.score} | Load: ${p.loadTimeMs}ms | H1s: ${p.h1Count} | Title: ${p.title || "MISSING"}`);

  return `You are a senior SEO consultant. Generate a complete, professional HTML+CSS SEO audit report for a client.

AUDIT SUMMARY:
- Sites: ${urls.join(", ")}
- Total pages: ${auditData.length}
- Avg score: ${avgScore.toFixed(1)}/100
- Critical (< 40): ${critical} | Warnings (40–70): ${warnings} | Good (≥ 70): ${good}
- Missing titles: ${auditData.filter(p => !p.title).length}
- Missing descriptions: ${auditData.filter(p => !p.description).length}
- No H1: ${auditData.filter(p => p.h1Count === 0).length}
- Slow pages (>3s): ${auditData.filter(p => p.loadTimeMs > 3000).length}
- Broken (4xx/5xx): ${auditData.filter(p => p.statusCode >= 400).length}

WORST PAGES:
${topIssues.join("\n")}

ALL DATA (JSON):
${JSON.stringify(auditData.slice(0, 30), null, 2)}

REQUIREMENTS:
1. Dark theme: navy/slate background, white text, accents violet #7c3aed, emerald #10b981, amber #f59e0b, red #ef4444
2. Header: report title, date, domains audited
3. Executive summary: large stat cards (total pages, avg score, critical issues)
4. Visual score breakdown with CSS bar charts
5. Full pages table: URL, Score, Title, H1, Load Time, Status — color-coded rows
6. Top 5 prioritised recommendations with action items
7. Footer: "Generated by SEO Audit Tool" + date
8. Inline CSS only — self-contained, no external dependencies
9. Google Fonts via @import (Inter)
10. Premium agency look — clean spacing, subtle gradients

Return ONLY the complete HTML document starting with <!DOCTYPE html>.`;
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
  const { urls, keys, auditId } = await req.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encode = encoder();
      const emit = (event: SSEEvent) => {
        try { controller.enqueue(encode(event)); } catch {}
      };

      try {
        // ── Step 1: Crawl ──
        emit({ step: "crawl", type: "start", message: `Crawling ${urls.length} site(s)...` });
        const allPages: FirecrawlPage[] = [];
        for (const url of urls) {
          emit({ step: "crawl", type: "progress", message: "Starting crawl", detail: url });
          const pages = await crawlSite(url, keys.firecrawl, emit);
          allPages.push(...pages);
        }
        emit({ step: "crawl", type: "done", message: `Found ${allPages.length} pages across ${urls.length} site(s)` });

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
