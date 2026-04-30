"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Globe, Zap, Settings, FileText, Plus, X, ChevronRight, Clock, CheckCircle, AlertCircle, Loader2, List } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

interface AuditRecord {
  id: string;
  urls: string[];
  createdAt: string;
  status: "pending" | "running" | "done" | "error";
  mode?: "crawl" | "audit-only";
}

type Mode = "crawl" | "audit-only";

export default function Dashboard() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("crawl");
  const [urls, setUrls] = useState<string[]>([""]);
  const [pageUrls, setPageUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<AuditRecord[]>([]);
  const [hasKeys, setHasKeys] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("seo_audit_history");
    if (saved) setHistory(JSON.parse(saved));
    const keys = localStorage.getItem("seo_api_keys");
    if (keys) {
      const p = JSON.parse(keys);
      setHasKeys(!!(p.firecrawl && p.dataforseo_login && p.dataforseo_password && p.anthropic));
    }
  }, []);

  const addUrl = () => setUrls([...urls, ""]);
  const removeUrl = (i: number) => setUrls(urls.filter((_, idx) => idx !== i));
  const updateUrl = (i: number, val: string) => { const n = [...urls]; n[i] = val; setUrls(n); };

  const startAudit = async () => {
    setError("");

    let cleanUrls: string[] = [];
    if (mode === "crawl") {
      cleanUrls = urls.map(u => u.trim()).filter(Boolean);
      if (!cleanUrls.length) return setError("Add at least one URL.");
    } else {
      cleanUrls = pageUrls.split("\n").map(u => u.trim()).filter(Boolean);
      if (!cleanUrls.length) return setError("Paste at least one page URL.");
    }

    if (!hasKeys) return setError("Configure your API keys in Settings first.");
    setLoading(true);

    const keys = JSON.parse(localStorage.getItem("seo_api_keys") || "{}");
    const id = `audit_${Date.now()}`;
    const record: AuditRecord = { id, urls: cleanUrls, createdAt: new Date().toISOString(), status: "running", mode };
    const next = [record, ...history];
    setHistory(next);
    localStorage.setItem("seo_audit_history", JSON.stringify(next));

    router.push(
      `/audit/${id}?urls=${encodeURIComponent(JSON.stringify(cleanUrls))}&keys=${encodeURIComponent(JSON.stringify(keys))}&mode=${mode}`
    );
  };

  const statusIcon = (status: AuditRecord["status"]) => {
    if (status === "running") return <Loader2 size={14} className="animate-spin text-violet-500" />;
    if (status === "done") return <CheckCircle size={14} className="text-emerald-500" />;
    if (status === "error") return <AlertCircle size={14} className="text-red-500" />;
    return <Clock size={14} className="text-subtle" />;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b divider px-6 py-4 flex items-center justify-between bg-surface">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Zap size={15} className="text-white" />
          </div>
          <span className="font-semibold text-main">SEO Audit</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link
            href="/settings"
            className="flex items-center gap-2 text-sm text-muted hover:text-main transition-colors px-3 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Settings size={15} />
            Settings
            {!hasKeys && <span className="w-2 h-2 rounded-full bg-amber-400" />}
          </Link>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-main mb-2">SEO Audit</h1>
          <p className="text-muted">Crawl any website, audit every page, get a polished PDF report.</p>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-black/5 dark:bg-white/5 mb-4 w-fit">
          {(["crawl", "audit-only"] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === m
                  ? "bg-surface text-main shadow-sm border border-base"
                  : "text-muted hover:text-main"
              }`}
            >
              {m === "crawl" ? <><Globe size={14} /> Crawl & Audit</> : <><List size={14} /> Audit Pages Directly</>}
            </button>
          ))}
        </div>

        {/* Input card */}
        <div className="card rounded-2xl p-6 mb-4 shadow-sm">
          {mode === "crawl" ? (
            <>
              <div className="flex items-center gap-2 mb-4">
                <Globe size={15} className="text-violet-500" />
                <span className="text-sm font-medium text-main">Base URLs to Crawl</span>
                <span className="text-xs text-subtle ml-auto">Firecrawl will discover all pages automatically</span>
              </div>
              <div className="space-y-3">
                {urls.map((url, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="url"
                      value={url}
                      onChange={e => updateUrl(i, e.target.value)}
                      placeholder="https://example.com"
                      className="flex-1 input-base rounded-xl px-4 py-3 text-sm placeholder-subtle transition-all"
                    />
                    {urls.length > 1 && (
                      <button onClick={() => removeUrl(i)} className="p-3 rounded-xl text-subtle hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addUrl} className="mt-3 flex items-center gap-2 text-sm text-subtle hover:text-violet-600 transition-colors py-1">
                <Plus size={13} /> Add another domain
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <List size={15} className="text-violet-500" />
                <span className="text-sm font-medium text-main">Page URLs to Audit</span>
              </div>
              <p className="text-xs text-subtle mb-4">
                Paste individual page URLs, one per line. Skips Firecrawl — goes straight to DataForSEO.
              </p>
              <textarea
                value={pageUrls}
                onChange={e => setPageUrls(e.target.value)}
                placeholder={"https://example.com\nhttps://example.com/about\nhttps://example.com/services"}
                rows={6}
                className="w-full input-base rounded-xl px-4 py-3 text-sm placeholder-subtle transition-all resize-none font-mono"
              />
              <p className="text-xs text-subtle mt-2">
                {pageUrls.split("\n").filter(u => u.trim()).length} URLs entered
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500 mb-4 px-1">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <button
          onClick={startAudit}
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? <><Loader2 size={15} className="animate-spin" /> Starting...</> : <><Zap size={15} /> Run Audit</>}
        </button>

        {!hasKeys && (
          <p className="text-center text-xs text-subtle mt-3">
            You need to{" "}
            <Link href="/settings" className="text-violet-600 hover:underline underline-offset-2">configure API keys</Link>
            {" "}first.
          </p>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={14} className="text-subtle" />
              <span className="text-sm font-medium text-muted">Recent Audits</span>
            </div>
            <div className="space-y-2">
              {history.slice(0, 8).map(r => (
                <Link
                  key={r.id}
                  href={`/audit/${r.id}`}
                  className="card card-hover rounded-xl px-4 py-3.5 flex items-center justify-between group transition-all shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    {statusIcon(r.status)}
                    <div>
                      <p className="text-sm text-main font-medium truncate max-w-xs">
                        {r.urls[0]}
                        {r.urls.length > 1 && <span className="text-subtle ml-1">+{r.urls.length - 1} more</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-subtle">{new Date(r.createdAt).toLocaleString()}</p>
                        {r.mode === "audit-only" && <span className="text-xs text-violet-500 bg-violet-50 dark:bg-violet-500/10 px-1.5 py-0.5 rounded">Audit only</span>}
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-subtle group-hover:text-muted transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
