"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle, XCircle, Loader2, Download, ArrowLeft,
  Globe, Search, FileText, Sparkles, ChevronRight,
} from "lucide-react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────

type StepKey = "crawl" | "audit" | "report" | "pdf";

interface StepState {
  status: "idle" | "running" | "done" | "error";
  summary: string;
  log: { message: string; detail?: string; ts: number }[];
}

interface SSEEvent {
  step: string;
  type: "start" | "progress" | "done" | "error";
  message: string;
  detail?: string;
  data?: { downloadUrl?: string; pageCount?: number };
}

// ── Step metadata ──────────────────────────────────────────────────────────

const STEPS: { key: StepKey; icon: React.ElementType; label: string; color: string }[] = [
  { key: "crawl",  icon: Globe,     label: "Crawling Site",     color: "blue"    },
  { key: "audit",  icon: Search,    label: "SEO Audit",         color: "violet"  },
  { key: "report", icon: Sparkles,  label: "Generating Report", color: "amber"   },
  { key: "pdf",    icon: FileText,  label: "Building PDF",      color: "emerald" },
];

const colorMap: Record<string, string> = {
  blue:    "bg-blue-500/15 text-blue-400 border-blue-500/20",
  violet:  "bg-violet-500/15 text-violet-400 border-violet-500/20",
  amber:   "bg-amber-500/15 text-amber-400 border-amber-500/20",
  emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

const ringMap: Record<string, string> = {
  blue:    "border-blue-500/30 bg-blue-500/[0.03]",
  violet:  "border-violet-500/30 bg-violet-500/[0.03]",
  amber:   "border-amber-500/30 bg-amber-500/[0.03]",
  emerald: "border-emerald-500/30 bg-emerald-500/[0.03]",
};

// ── Component ──────────────────────────────────────────────────────────────

export default function AuditPage({ params }: { params: { id: string } }) {
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

  const updateStep = (key: StepKey, patch: Partial<StepState>) =>
    setSteps(p => ({ ...p, [key]: { ...p[key], ...patch } }));

  const appendLog = (key: StepKey, message: string, detail?: string) => {
    setSteps(p => ({
      ...p,
      [key]: { ...p[key], log: [...p[key].log, { message, detail, ts: Date.now() }] },
    }));
    // Auto-scroll log
    setTimeout(() => {
      const el = logRefs.current[key];
      if (el) el.scrollTop = el.scrollHeight;
    }, 30);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const urlsParam = searchParams.get("urls");
    const keysParam = searchParams.get("keys");
    if (!urlsParam || !keysParam) { setFatalError("Missing parameters — go back and start a new audit."); return; }

    const urls: string[] = JSON.parse(decodeURIComponent(urlsParam));
    const keys = JSON.parse(decodeURIComponent(keysParam));

    runStream(urls, keys);
  }, []);

  async function runStream(urls: string[], keys: Record<string, string>) {
    const res = await fetch("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, keys, auditId: params.id }),
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
        try {
          const event: SSEEvent = JSON.parse(line.slice(5).trim());
          handleEvent(event);
        } catch {}
      }
    }
  }

  function handleEvent(ev: SSEEvent) {
    if (ev.step === "done") {
      setPdfUrl(ev.data?.downloadUrl ?? null);
      setPageCount(ev.data?.pageCount ?? null);
      const hist = JSON.parse(localStorage.getItem("seo_audit_history") || "[]");
      localStorage.setItem("seo_audit_history", JSON.stringify(
        hist.map((r: { id: string }) => r.id === params.id ? { ...r, status: "done", pdfPath: ev.data?.downloadUrl } : r)
      ));
      return;
    }

    if (ev.step === "error") {
      setFatalError(ev.message);
      const hist = JSON.parse(localStorage.getItem("seo_audit_history") || "[]");
      localStorage.setItem("seo_audit_history", JSON.stringify(
        hist.map((r: { id: string }) => r.id === params.id ? { ...r, status: "error" } : r)
      ));
      return;
    }

    const key = ev.step as StepKey;
    if (!["crawl", "audit", "report", "pdf"].includes(key)) return;

    if (ev.type === "start") {
      updateStep(key, { status: "running", summary: ev.message });
      appendLog(key, ev.message, ev.detail);
    } else if (ev.type === "progress") {
      updateStep(key, { summary: ev.message });
      appendLog(key, ev.message, ev.detail);
    } else if (ev.type === "done") {
      updateStep(key, { status: "done", summary: ev.message });
      appendLog(key, ev.message, ev.detail);
    } else if (ev.type === "error") {
      updateStep(key, { status: "error", summary: ev.message });
      setFatalError(ev.message);
    }
  }

  const progress = STEPS.filter(s => steps[s.key].status === "done").length;
  const activeStep = STEPS.find(s => steps[s.key].status === "running");

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-4">
        <Link href="/" className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-all">
          <ArrowLeft size={16} />
        </Link>
        <span className="font-semibold text-white">Audit in Progress</span>
        {activeStep && (
          <span className="ml-auto text-xs text-zinc-500 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {activeStep.label}
          </span>
        )}
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-zinc-500 mb-2">
            <span>{pdfUrl ? "Complete" : activeStep ? activeStep.label : "Starting..."}</span>
            <span>{progress} / {STEPS.length} steps</span>
          </div>
          <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${(progress / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-8">
          {STEPS.map(step => {
            const s = steps[step.key];
            const Icon = step.icon;
            const isRunning = s.status === "running";
            const isDone = s.status === "done";
            const isError = s.status === "error";
            const isIdle = s.status === "idle";
            const col = step.color;

            return (
              <div
                key={step.key}
                className={`glass rounded-2xl overflow-hidden transition-all duration-300
                  ${isRunning ? `border ${ringMap[col]}` : ""}
                  ${isIdle ? "opacity-40" : ""}`}
              >
                {/* Step header */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border
                    ${isDone ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-400" :
                      isError ? "bg-red-500/15 border-red-500/25 text-red-400" :
                      isRunning ? `${colorMap[col]} border` :
                      "bg-white/[0.04] border-white/[0.07] text-zinc-600"}`}
                  >
                    {isDone ? <CheckCircle size={15} /> :
                     isError ? <XCircle size={15} /> :
                     isRunning ? <Loader2 size={15} className="animate-spin" /> :
                     <Icon size={15} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isDone ? "text-white" : isRunning ? "text-white" : "text-zinc-500"}`}>
                      {step.label}
                    </p>
                  </div>

                  <span className={`text-xs tabular-nums flex-shrink-0
                    ${isDone ? "text-emerald-500" : isRunning ? `text-${col}-400` : "text-zinc-700"}`}>
                    {s.summary}
                  </span>
                </div>

                {/* Live log — shown while running or done with entries */}
                {(isRunning || isDone) && s.log.length > 0 && (
                  <div
                    ref={el => { logRefs.current[step.key] = el; }}
                    className="border-t border-white/[0.05] bg-black/20 max-h-36 overflow-y-auto px-4 py-2 space-y-0.5"
                  >
                    {s.log.map((entry, i) => (
                      <div key={i} className="flex items-baseline gap-2 text-xs">
                        <ChevronRight size={10} className="text-zinc-700 flex-shrink-0 mt-0.5" />
                        <span className="text-zinc-400 flex-shrink-0">{entry.message}</span>
                        {entry.detail && (
                          <span className="text-zinc-600 truncate">{entry.detail}</span>
                        )}
                      </div>
                    ))}
                    {isRunning && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="w-1 h-1 rounded-full bg-current animate-ping" style={{ color: "currentColor" }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Fatal error */}
        {fatalError && (
          <div className="glass rounded-2xl p-4 border border-red-500/20 bg-red-500/[0.04] mb-4">
            <p className="text-sm font-medium text-red-400 mb-1">Audit failed</p>
            <p className="text-xs text-red-500/60">{fatalError}</p>
          </div>
        )}

        {/* Download */}
        {pdfUrl && (
          <div className="glass rounded-2xl p-6 border border-emerald-500/20 bg-emerald-500/[0.03] text-center">
            <CheckCircle size={28} className="text-emerald-400 mx-auto mb-3" />
            <p className="text-white font-semibold mb-0.5">Report Ready</p>
            {pageCount && <p className="text-zinc-500 text-sm mb-5">{pageCount} pages audited</p>}
            <a
              href={pdfUrl}
              download
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-sm transition-all"
            >
              <Download size={15} />
              Download PDF Report
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
