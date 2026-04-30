import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { html, auditId } = await req.json();
    if (!html || !auditId) {
      return NextResponse.json({ error: "Missing html or auditId" }, { status: 400 });
    }

    const reportsDir = path.join(process.cwd(), "public", "reports");
    await mkdir(reportsDir, { recursive: true });

    const fileName = `${auditId}.pdf`;
    const filePath = path.join(reportsDir, fileName);

    // Dynamically import puppeteer to avoid issues during build
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    await browser.close();
    await writeFile(filePath, pdfBuffer);

    return NextResponse.json({ downloadUrl: `/reports/${fileName}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "PDF generation error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
