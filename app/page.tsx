"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Globe, Zap, Settings, FileText, Plus, X, ChevronRight, Clock, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";

interface AuditRecord {
  id: string;
  urls: string[];
  createdAt: string;
  status: "pending" | "running" | "done" | "error";
  pdfPath?: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<AuditRecord[]>([]);
  const [hasKeys, setHasKeys] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("seo_audit_history");
    if (saved) setHistory(JSON.parse(saved));
    const keys = localStorage.getItem("seo_api_keys");
    if (keys) {
      const parsed = JSON.parse(keys);
      setHasKeys(!!(parsed.firecrawl && parsed.dataforseo_login && parsed.dataforseo_password && parsed.anthropic));
    }
  }, []);

  const addUrl = () => setUrls([...urls, ""]);
  const removeUrl = (i: number) => setUrls(urls.filter((_, idx) => idx !== i));
  const updateUrl = (i: number, val: string) => {
    const next = [...urls];
    next[i] = val;
    setUrls(next);
  };

  const startAudit = async () => {
    const clean = urls.map(u => u.trim()).filter(Boolean);
    if (!clean.length) return setError("Add at least one URL.");
    if (!hasKeys) return setError("Configure your API keys in Settings first.");

    setError("");
    setLoading(true);

    const keys = JSON.parse(localStorage.getItem("seo_api_keys") || "{}");
    const id = `audit_${Date.now()}`;

    const record: AuditRecord = { id, urls: clean, createdAt: new Date().toISOString(), status: "running" };
    const next = [record, ...history];
    setHistory(next);
    localStorage.setItem("seo_audit_history", JSON.stringify(next));

    router.push(`/audit/${id}?urls=${encodeURIComponent(JSON.stringify(clean))}&keys=${encodeURIComponent(JSON.stringify(keys))}`);
  };

  const statusIcon = (status: AuditRecord["status"]) => {
    if (status === "running") return <Loader2 size={16} className="animate-spin text-blue-400" />;
    if (status === "done") return <CheckCircle size={16} className="text-emerald-400" />;
    if (status === "error") return <AlertCircle size={16} className="text-red-400" />;
    return <Clock size={16} className="text-zinc-500" />;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-white/[0.06] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-semibold text-white">SEO Audit</span>
        </div>
        <Link
          href="/settings"
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/[0.05]"
        >
          <Settings size={15} />
          Settings
          {!hasKeys && <span className="w-2 h-2 rounded-full bg-amber-400 ml-1" />}
        </Link>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-12">
        {/* Hero */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">SEO Audit</h1>
          <p className="text-zinc-400">Crawl any website, audit every page, generate a polished PDF report.</p>
        </div>

        {/* URL Input Card */}
        <div className="glass rounded-2xl p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={16} className="text-violet-400" />
            <span className="text-sm font-medium text-zinc-300">URLs to Audit</span>
          </div>

          <div className="space-y-3">
            {urls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={e => updateUrl(i, e.target.value)}
                  placeholder="https://example.com"
                  className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.07] transition-all"
                />
                {urls.length > 1 && (
                  <button onClick={() => removeUrl(i)} className="p-3 rounded-xl text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-all">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addUrl}
            className="mt-3 flex items-center gap-2 text-sm text-zinc-500 hover:text-violet-400 transition-colors py-1"
          >
            <Plus size={14} />
            Add another URL
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 mb-4 px-1">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <button
          onClick={startAudit}
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? <><Loader2 size={16} className="animate-spin" /> Starting audit...</> : <><Zap size={16} /> Run Audit</>}
        </button>

        {!hasKeys && (
          <p className="text-center text-xs text-zinc-600 mt-3">
            You need to{" "}
            <Link href="/settings" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
              configure API keys
            </Link>{" "}
            before running an audit.
          </p>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={15} className="text-zinc-500" />
              <span className="text-sm font-medium text-zinc-400">Recent Audits</span>
            </div>
            <div className="space-y-2">
              {history.slice(0, 8).map(r => (
                <Link
                  key={r.id}
                  href={`/audit/${r.id}`}
                  className="glass glass-hover rounded-xl px-4 py-3.5 flex items-center justify-between group transition-all"
                >
                  <div className="flex items-center gap-3">
                    {statusIcon(r.status)}
                    <div>
                      <p className="text-sm text-white font-medium truncate max-w-xs">
                        {r.urls[0]}{r.urls.length > 1 && <span className="text-zinc-500 ml-1">+{r.urls.length - 1} more</span>}
                      </p>
                      <p className="text-xs text-zinc-600 mt-0.5">{new Date(r.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
