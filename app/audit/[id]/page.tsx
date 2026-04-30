"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, XCircle, Loader2, Download, ArrowLeft, Globe, Search, FileText, Sparkles } from "lucide-react";
import Link from "next/link";

interface StepState {
  status: "idle" | "running" | "done" | "error";
  message: string;
  detail?: string;
}

type StepKey = "crawl" | "audit" | "report" | "pdf";

const STEPS: { key: StepKey; icon: React.ElementType; label: string; desc: string }[] = [
  { key: "crawl", icon: Globe, label: "Crawling Site", desc: "Discovering all pages with Firecrawl" },
  { key: "audit", icon: Search, label: "SEO Audit", desc: "Analysing every page with DataForSEO" },
  { key: "report", icon: Sparkles, label: "Generating Report", desc: "Claude is designing your PDF" },
  { key: "pdf", icon: FileText, label: "Building PDF", desc: "Rendering final document" },
];

export default function AuditPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    crawl: { status: "idle", message: "Waiting..." },
    audit: { status: "idle", message: "Waiting..." },
    report: { status: "idle", message: "Waiting..." },
    pdf: { status: "idle", message: "Waiting..." },
  });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const started = useRef(false);

  const setStep = (key: StepKey, update: Partial<StepState>) => {
    setSteps(p => ({ ...p, [key]: { ...p[key], ...update } }));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const urlsParam = searchParams.get("urls");
    const keysParam = searchParams.get("keys");
    if (!urlsParam || !keysParam) {
      setFatalError("Missing parameters. Go back and start a new audit.");
      return;
    }

    const urls: string[] = JSON.parse(decodeURIComponent(urlsParam));
    const keys = JSON.parse(decodeURIComponent(keysParam));

    runAudit(urls, keys);
  }, []);

  async function runAudit(urls: string[], keys: Record<string, string>) {
    try {
      // Step 1: Crawl
      setStep("crawl", { status: "running", message: `Crawling ${urls.length} site(s)...` });
      const crawlRes = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, firecrawlKey: keys.firecrawl }),
      });
      if (!crawlRes.ok) throw new Error(`Crawl failed: ${(await crawlRes.json()).error}`);
      const { pages } = await crawlRes.json();
      setPageCount(pages.length);
      setStep("crawl", { status: "done", message: `Found ${pages.length} pages`, detail: urls.join(", ") });

      // Step 2: Audit
      setStep("audit", { status: "running", message: `Auditing ${pages.length} pages...` });
      const auditRes = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, login: keys.dataforseo_login, password: keys.dataforseo_password }),
      });
      if (!auditRes.ok) throw new Error(`Audit failed: ${(await auditRes.json()).error}`);
      const { auditData } = await auditRes.json();
      setStep("audit", { status: "done", message: `Audited ${auditData.length} pages` });

      // Step 3: Generate report HTML with Claude
      setStep("report", { status: "running", message: "Claude is writing your report..." });
      const reportRes = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditData, urls, anthropicKey: keys.anthropic }),
      });
      if (!reportRes.ok) throw new Error(`Report failed: ${(await reportRes.json()).error}`);
      const { html } = await reportRes.json();
      setStep("report", { status: "done", message: "Report designed" });

      // Step 4: PDF
      setStep("pdf", { status: "running", message: "Rendering PDF..." });
      const pdfRes = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, auditId: params.id }),
      });
      if (!pdfRes.ok) throw new Error(`PDF failed: ${(await pdfRes.json()).error}`);
      const { downloadUrl } = await pdfRes.json();
      setStep("pdf", { status: "done", message: "PDF ready!" });
      setPdfUrl(downloadUrl);

      // Update history
      const history = JSON.parse(localStorage.getItem("seo_audit_history") || "[]");
      const updated = history.map((r: { id: string }) =>
        r.id === params.id ? { ...r, status: "done", pdfPath: downloadUrl } : r
      );
      localStorage.setItem("seo_audit_history", JSON.stringify(updated));

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setFatalError(msg);
      const history = JSON.parse(localStorage.getItem("seo_audit_history") || "[]");
      const updated = history.map((r: { id: string }) =>
        r.id === params.id ? { ...r, status: "error" } : r
      );
      localStorage.setItem("seo_audit_history", JSON.stringify(updated));
    }
  }

  const allDone = pdfUrl !== null;
  const active = STEPS.find(s => steps[s.key].status === "running");
  const progress = STEPS.filter(s => steps[s.key].status === "done").length;

  return (
    <div className="min-h-screen">
      <nav className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-4">
        <Link href="/" className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-all">
          <ArrowLeft size={16} />
        </Link>
        <span className="font-semibold text-white">Audit in Progress</span>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* Progress bar */}
        <div className="mb-10">
          <div className="flex justify-between text-xs text-zinc-500 mb-2">
            <span>{allDone ? "Complete" : active ? active.label : "Starting..."}</span>
            <span>{progress} / {STEPS.length}</span>
          </div>
          <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${(progress / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-8">
          {STEPS.map((step, i) => {
            const s = steps[step.key];
            const Icon = step.icon;
            const isActive = s.status === "running";
            const isDone = s.status === "done";
            const isError = s.status === "error";
            const isIdle = s.status === "idle";

            return (
              <div
                key={step.key}
                className={`glass rounded-2xl p-4 flex items-start gap-4 transition-all duration-300 ${isActive ? "border-violet-500/30 bg-violet-500/[0.04]" : ""} ${isIdle ? "opacity-40" : ""}`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isDone ? "bg-emerald-500/15" : isActive ? "bg-violet-500/15" : isError ? "bg-red-500/15" : "bg-white/[0.05]"}`}>
                  {isDone ? <CheckCircle size={16} className="text-emerald-400" /> :
                   isError ? <XCircle size={16} className="text-red-400" /> :
                   isActive ? <Loader2 size={16} className="text-violet-400 animate-spin" /> :
                   <Icon size={16} className="text-zinc-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-medium ${isDone ? "text-white" : isActive ? "text-violet-200" : "text-zinc-500"}`}>
                      {step.label}
                    </p>
                    <span className={`text-xs ${isDone ? "text-emerald-500" : isActive ? "text-violet-400" : "text-zinc-700"}`}>
                      {s.message}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">{step.desc}</p>
                  {s.detail && <p className="text-xs text-zinc-700 mt-1 truncate">{s.detail}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Fatal error */}
        {fatalError && (
          <div className="glass rounded-2xl p-4 border border-red-500/20 bg-red-500/[0.04] text-sm text-red-400">
            <p className="font-medium mb-1">Audit failed</p>
            <p className="text-xs text-red-500/70">{fatalError}</p>
          </div>
        )}

        {/* Download */}
        {pdfUrl && (
          <div className="glass rounded-2xl p-6 border border-emerald-500/20 bg-emerald-500/[0.03] text-center">
            <CheckCircle size={32} className="text-emerald-400 mx-auto mb-3" />
            <p className="text-white font-semibold mb-1">Report Ready</p>
            {pageCount && <p className="text-zinc-500 text-sm mb-4">{pageCount} pages audited</p>}
            <a
              href={pdfUrl}
              download
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-sm transition-all"
            >
              <Download size={16} />
              Download PDF Report
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
