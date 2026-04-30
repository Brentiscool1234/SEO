import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

interface FirecrawlPage {
  url: string;
  title?: string;
  description?: string;
  statusCode?: number;
}

interface CrawlStatusResponse {
  status: string;
  data?: FirecrawlPage[];
}

async function crawlSite(baseUrl: string, apiKey: string): Promise<FirecrawlPage[]> {
  // Start crawl job
  const start = await axios.post(
    "https://api.firecrawl.dev/v1/crawl",
    {
      url: baseUrl,
      limit: 50,
      scrapeOptions: { formats: ["markdown"] },
    },
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  const jobId: string = start.data.id;

  // Poll until complete
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await axios.get<CrawlStatusResponse>(
      `https://api.firecrawl.dev/v1/crawl/${jobId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (status.data.status === "completed") {
      return (status.data.data || []).map((p: FirecrawlPage) => ({
        url: p.url,
        title: p.title || "",
        description: p.description || "",
        statusCode: p.statusCode || 200,
      }));
    }
    if (status.data.status === "failed") throw new Error("Firecrawl job failed");
  }
  throw new Error("Crawl timed out after 5 minutes");
}

export async function POST(req: NextRequest) {
  try {
    const { urls, firecrawlKey } = await req.json();
    if (!urls?.length || !firecrawlKey) {
      return NextResponse.json({ error: "Missing urls or firecrawlKey" }, { status: 400 });
    }

    const allPages: FirecrawlPage[] = [];
    for (const url of urls) {
      const pages = await crawlSite(url, firecrawlKey);
      allPages.push(...pages);
    }

    return NextResponse.json({ pages: allPages });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Crawl error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
