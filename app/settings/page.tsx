"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Key, Eye, EyeOff, CheckCircle, Save, ExternalLink, FlaskConical, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Keys {
  firecrawl: string;
  dataforseo_login: string;
  dataforseo_password: string;
  anthropic: string;
}

const fields: { key: keyof Keys; label: string; placeholder: string; hint: string; link: string }[] = [
  {
    key: "firecrawl",
    label: "Firecrawl API Key",
    placeholder: "fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    hint: "Used to crawl websites and discover all pages.",
    link: "https://firecrawl.dev",
  },
  {
    key: "dataforseo_login",
    label: "DataForSEO Login",
    placeholder: "you@example.com",
    hint: "Your DataForSEO account email address.",
    link: "https://dataforseo.com",
  },
  {
    key: "dataforseo_password",
    label: "DataForSEO API Password",
    placeholder: "••••••••••••••••",
    hint: "Your DataForSEO API password — find it in your dashboard under API Access, not your account login password.",
    link: "https://app.dataforseo.com/api-access",
  },
  {
    key: "anthropic",
    label: "Anthropic API Key",
    placeholder: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    hint: "Used by Claude to design and generate the PDF report.",
    link: "https://console.anthropic.com",
  },
];

type TestState = { status: "idle" | "loading" | "ok" | "error"; message: string };

export default function SettingsPage() {
  const [keys, setKeys] = useState<Keys>({ firecrawl: "", dataforseo_login: "", dataforseo_password: "", anthropic: "" });
  const [show, setShow] = useState<Record<keyof Keys, boolean>>({ firecrawl: false, dataforseo_login: false, dataforseo_password: false, anthropic: false });
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle", message: "" });

  useEffect(() => {
    const stored = localStorage.getItem("seo_api_keys");
    if (stored) setKeys(JSON.parse(stored));
  }, []);

  const save = () => {
    localStorage.setItem("seo_api_keys", JSON.stringify(keys));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const toggleShow = (k: keyof Keys) => setShow(p => ({ ...p, [k]: !p[k] }));
  const allFilled = Object.values(keys).every(Boolean);

  const testConnection = async () => {
    if (!keys.dataforseo_login || !keys.dataforseo_password) {
      setTest({ status: "error", message: "Enter your DataForSEO login and password first." });
      return;
    }
    setTest({ status: "loading", message: "Connecting to DataForSEO..." });
    try {
      const res = await fetch("/api/test-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: keys.dataforseo_login, password: keys.dataforseo_password }),
      });
      const data = await res.json();
      if (data.ok) {
        const balance = data.money != null ? ` — Balance: ${data.currency ?? ""}${data.money}` : "";
        setTest({ status: "ok", message: `Connected as ${data.email}${balance}` });
      } else {
        setTest({ status: "error", message: data.message });
      }
    } catch {
      setTest({ status: "error", message: "Network error — is the server running?" });
    }
  };

  return (
    <div className="min-h-screen">
      <nav className="border-b divider px-6 py-4 flex items-center gap-3 bg-surface">
        <Link href="/" className="p-2 rounded-lg text-subtle hover:text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2">
          <Key size={15} className="text-violet-500" />
          <span className="font-semibold text-main">Settings</span>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-main mb-1">API Keys</h1>
          <p className="text-sm text-muted">Stored locally in your browser — never sent anywhere except the respective APIs.</p>
        </div>

        <div className="space-y-4">
          {fields.map(f => (
            <div key={f.key} className="card rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-main">{f.label}</label>
                <a href={f.link} target="_blank" rel="noreferrer" className="text-xs text-subtle hover:text-violet-600 flex items-center gap-1 transition-colors">
                  {f.key === "dataforseo_password" ? "Open API Access page" : "Get key"} <ExternalLink size={10} />
                </a>
              </div>
              <p className="text-xs text-muted mb-3 leading-relaxed">{f.hint}</p>
              <div className="relative">
                <input
                  type={show[f.key] ? "text" : "password"}
                  value={keys[f.key]}
                  onChange={e => setKeys(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full input-base rounded-xl px-4 py-3 pr-11 text-sm placeholder-subtle transition-all"
                />
                <button onClick={() => toggleShow(f.key)} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle hover:text-muted transition-colors">
                  {show[f.key] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {keys[f.key] && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle size={11} /> Set
                </div>
              )}
            </div>
          ))}
        </div>

        {/* DataForSEO note */}
        <div className="mt-4 card rounded-xl p-4 border-l-4 border-l-amber-400 shadow-sm">
          <p className="text-xs text-muted leading-relaxed">
            <span className="font-semibold text-main">DataForSEO API Password</span> is separate from your login password.
            Go to <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noreferrer" className="text-violet-600 hover:underline underline-offset-2">app.dataforseo.com/api-access</a> to find or generate it.
          </p>
        </div>

        {/* Test DataForSEO connection */}
        <div className="mt-4 card rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-main">Test DataForSEO Connection</p>
              <p className="text-xs text-muted mt-0.5">Verify your credentials before running an audit.</p>
            </div>
            <button
              onClick={testConnection}
              disabled={test.status === "loading"}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/20 text-sm font-medium transition-all disabled:opacity-50"
            >
              {test.status === "loading"
                ? <><Loader2 size={14} className="animate-spin" /> Testing...</>
                : <><FlaskConical size={14} /> Test</>}
            </button>
          </div>

          {test.status !== "idle" && test.status !== "loading" && (
            <div className={`mt-3 flex items-start gap-2 text-xs rounded-lg px-3 py-2.5
              ${test.status === "ok"
                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"}`}
            >
              {test.status === "ok"
                ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />
                : <XCircle size={13} className="flex-shrink-0 mt-0.5" />}
              <span className="break-all leading-relaxed">{test.message}</span>
            </div>
          )}
        </div>

        <button
          onClick={save}
          disabled={!allFilled}
          className="mt-6 w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saved ? <><CheckCircle size={15} /> Saved!</> : <><Save size={15} /> Save Keys</>}
        </button>
        {!allFilled && <p className="text-center text-xs text-subtle mt-3">Fill all fields to save.</p>}
      </main>
    </div>
  );
}
