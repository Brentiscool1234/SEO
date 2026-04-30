import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

interface Page {
  url: string;
  title?: string;
  description?: string;
  statusCode?: number;
}

interface DFSTaskResult {
  items?: DFSPageItem[];
}

interface DFSPageItem {
  url?: string;
  checks?: Record<string, unknown>;
  page_timing?: {
    time_to_interactive?: number;
    dom_complete?: number;
  };
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
  onpage_score?: number;
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

async function auditPages(pages: Page[], login: string, password: string): Promise<PageAuditData[]> {
  const auth = Buffer.from(`${login}:${password}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };

  // Post tasks in batches of 10
  const BATCH = 10;
  const results: PageAuditData[] = [];

  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
    const tasks = batch.map(p => ({ url: p.url }));

    const postRes = await axios.post(
      "https://api.dataforseo.com/v3/on_page/instant_pages",
      tasks,
      { headers }
    );

    const taskResults: DFSTaskResult[] = postRes.data?.tasks || [];
    for (let j = 0; j < batch.length; j++) {
      const items = taskResults[j]?.result?.[0]?.items as DFSPageItem[] | undefined;
      const item: DFSPageItem = items?.[0] ?? {};
      const page = batch[j];

      results.push({
        url: page.url,
        score: Math.round((item.onpage_score ?? 0) * 100) / 100,
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

export async function POST(req: NextRequest) {
  try {
    const { pages, login, password } = await req.json();
    if (!pages?.length || !login || !password) {
      return NextResponse.json({ error: "Missing pages or credentials" }, { status: 400 });
    }
    const auditData = await auditPages(pages, login, password);
    return NextResponse.json({ auditData });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Audit error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
