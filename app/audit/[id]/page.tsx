"use client";

import { useEffect, useState, useRef, use } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle, XCircle, Loader2, Download, ArrowLeft,
  Globe, Search, FileText, Sparkles, ChevronRight, Copy, FileDown,
} from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

// ── Types ──────────────────────────────────────────────────────────────────

type StepKey = "crawl" | "audit" | "report" | "pdf";

interface StepState {
  status: "idle" | "running" | "done" | "error";
  summary: string;
  log: { message: string; detail?: string }[];
}

interface SSEEvent {
  step: string;
  type: "start" | "progress" | "done" | "error";
  message: string;
  detail?: string;
  data?: { downloadUrl?: string; pageCount?: number; crawledUrls?: string[] };
}

// ── Step definitions ───────────────────────────────────────────────────────

const STEPS: { key: StepKey; icon: React.ElementType; label: string; desc: string }[] = [
  { key: "crawl",  icon: Globe,    label: "Crawling Site",     desc: "Firecrawl discovers all pages" },
  { key: "audit",  icon: Search,   label: "SEO Audit",         desc: "DataForSEO analyses each page" },
  { key: "report", icon: Sparkles, label: "Generating Report", desc: "Claude designs the PDF layout" },
  { key: "pdf",    icon: FileText, label: "Building PDF",      desc: "Puppeteer renders the document" },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: auditId } = use(params);
  const searchParams = useSearchParams();
  const started = useRef(false);
  const logRefs = useRef<Record<StepKey, HTMLDivElement | null>>({ crawl: null, audit: null, report: null, pdf: null });

  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    crawl:  { status: "idle", summary: "Waiting...", log: [] },
    audit:  { status: "idle", summary: "Waiting...", log: [] },
    report: { status: "idle", summary: "Waiting...", log: [] },
    pdf:    { status: "idle", summary: "Waiting...", log: [] },
  });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [crawledUrls, setCrawledUrls] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const updateStep = (key: StepKey, patch: Partial<StepState>) =>
    setSteps(p => ({ ...p, [key]: { ...p[key], ...patch } }));

  const appendLog = (key: StepKey, message: string, detail?: string) => {
    setSteps(p => ({ ...p, [key]: { ...p[key], log: [...p[key].log, { message, detail }] } }));
    setTimeout(() => { const el = logRefs.current[key]; if (el) el.scrollTop = el.scrollHeight; }, 30);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const urlsParam = searchParams.get("urls");
    const keysParam = searchParams.get("keys");
    const mode = searchParams.get("mode") ?? "crawl";
    if (!urlsParam || !keysParam) { setFatalError("Missing parameters — go back and start a new audit."); return; }
    runStream(JSON.parse(decodeURIComponent(urlsParam)), JSON.parse(decodeURIComponent(keysParam)), mode);
  }, []);

  async function runStream(urls: string[], keys: Record<string, string>, mode: string) {
    const res = await fetch("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, keys, auditId, mode }),
    });
    if (!res.body) { setFatalError("No response stream from server."); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        try { handleEvent(JSON.parse(line.slice(5).trim())); } catch {}
      }
    }
  }

  function handleEvent(ev: SSEEvent) {
    if (ev.step === "done") {
      setPdfUrl(ev.data?.downloadUrl ?? null);
      setPageCount(ev.data?.pageCount ?? null);
      updateHistory("done", ev.data?.downloadUrl);
      return;
    }
    if (ev.step === "error") {
      setFatalError(ev.message);
      updateHistory("error");
      return;
    }
    const key = ev.step as StepKey;
    if (!["crawl", "audit", "report", "pdf"].includes(key)) return;
    if (ev.type === "start")    { updateStep(key, { status: "running", summary: ev.message }); appendLog(key, ev.message, ev.detail); }
    else if (ev.type === "progress") { updateStep(key, { summary: ev.message }); appendLog(key, ev.message, ev.detail); }
    else if (ev.type === "done")     {
      updateStep(key, { status: "done", summary: ev.message });
      appendLog(key, ev.message, ev.detail);
      if (key === "crawl" && ev.data?.crawledUrls?.length) setCrawledUrls(ev.data.crawledUrls);
    }
    else if (ev.type === "error")    { updateStep(key, { status: "error", summary: ev.message }); setFatalError(ev.message); }
  }

  function updateHistory(status: "done" | "error", pdfPath?: string) {
    const hist = JSON.parse(localStorage.getItem("seo_audit_history") || "[]");
    localStorage.setItem("seo_audit_history", JSON.stringify(
      hist.map((r: { id: string }) => r.id === auditId ? { ...r, status, ...(pdfPath ? { pdfPath } : {}) } : r)
    ));
  }

  const progress = STEPS.filter(s => steps[s.key].status === "done").length;
  const activeStep = STEPS.find(s => steps[s.key].status === "running");

  const copyUrls = () => {
    navigator.clipboard.writeText(crawledUrls.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadUrls = () => {
    const blob = new Blob([crawledUrls.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `crawled-urls-${auditId}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b divider px-6 py-4 flex items-center gap-3 bg-surface">
        <Link href="/" className="p-2 rounded-lg text-subtle hover:text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all">
          <ArrowLeft size={16} />
        </Link>
        <span className="font-semibold text-main">Running Audit</span>
        {activeStep && (
          <span className="ml-auto text-xs text-muted flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> {activeStep.label}
          </span>
        )}
        <ThemeToggle />
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-muted mb-2">
            <span>{pdfUrl ? "Complete" : activeStep ? activeStep.label : "Starting..."}</span>
            <span>{progress} / {STEPS.length} steps</span>
          </div>
          <div className="h-1 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${(progress / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2.5 mb-8">
          {STEPS.map(step => {
            const s = steps[step.key];
            const Icon = step.icon;
            const isRunning = s.status === "running";
            const isDone    = s.status === "done";
            const isError   = s.status === "error";
            const isIdle    = s.status === "idle";

            return (
              <div
                key={step.key}
                className={`card rounded-2xl overflow-hidden shadow-sm transition-all duration-300
                  ${isRunning ? "ring-1 ring-violet-400/40" : ""}
                  ${isIdle ? "opacity-40" : ""}`}
              >
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                    ${isDone  ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                      isError ? "bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400" :
                      isRunning ? "bg-violet-50 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400" :
                      "bg-black/5 dark:bg-white/5 text-subtle"}`}
                  >
                    {isDone    ? <CheckCircle size={15} /> :
                     isError   ? <XCircle size={15} /> :
                     isRunning ? <Loader2 size={15} className="animate-spin" /> :
                     <Icon size={15} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isIdle ? "text-subtle" : "text-main"}`}>{step.label}</p>
                    <p className="text-xs text-subtle">{step.desc}</p>
                  </div>

                  <span className={`text-xs tabular-nums flex-shrink-0
                    ${isDone ? "text-emerald-600 dark:text-emerald-400" :
                      isRunning ? "text-violet-600 dark:text-violet-400" :
                      "text-subtle"}`}>
                    {s.summary}
                  </span>
                </div>

                {/* Live log */}
                {(isRunning || isDone) && s.log.length > 0 && (
                  <div
                    ref={el => { logRefs.current[step.key] = el; }}
                    className="border-t divider bg-black/[0.02] dark:bg-white/[0.02] max-h-36 overflow-y-auto px-4 py-2 space-y-0.5"
                  >
                    {s.log.map((entry, i) => (
                      <div key={i} className="flex items-baseline gap-2 text-xs py-0.5">
                        <ChevronRight size={10} className="text-subtle flex-shrink-0 mt-0.5" />
                        <span className="text-muted flex-shrink-0">{entry.message}</span>
                        {entry.detail && <span className="text-subtle truncate">{entry.detail}</span>}
                      </div>
                    ))}
                    {isRunning && (
                      <div className="flex items-center gap-1 py-1">
                        <span className="w-1 h-1 rounded-full bg-violet-400 animate-ping inline-block" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Crawled URLs export — shown as soon as crawl finishes */}
        {crawledUrls.length > 0 && (
          <div className="card rounded-2xl p-4 mb-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-main">{crawledUrls.length} URLs discovered</p>
                <p className="text-xs text-muted mt-0.5">Export now in case you need them later.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyUrls}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-muted hover:text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                >
                  {copied ? <><CheckCircle size={13} className="text-emerald-500" /> Copied!</> : <><Copy size={13} /> Copy</>}
                </button>
                <button
                  onClick={downloadUrls}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-all"
                >
                  <FileDown size={13} /> Download .txt
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fatal error */}
        {fatalError && (
          <div className="card rounded-2xl p-4 border-l-4 border-l-red-500 mb-4">
            <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">Audit failed</p>
            <p className="text-xs text-muted font-mono break-all">{fatalError}</p>
          </div>
        )}

        {/* Download */}
        {pdfUrl && (
          <div className="card rounded-2xl p-6 border-l-4 border-l-emerald-500 text-center shadow-sm">
            <CheckCircle size={28} className="text-emerald-500 mx-auto mb-3" />
            <p className="text-main font-semibold mb-0.5">Report Ready</p>
            {pageCount && <p className="text-muted text-sm mb-5">{pageCount} pages audited</p>}
            <a
              href={pdfUrl}
              download
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-medium text-sm transition-all shadow-sm"
            >
              <Download size={15} /> Download PDF Report
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
