"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Key, Eye, EyeOff, CheckCircle, Save, ExternalLink } from "lucide-react";
import Link from "next/link";

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
    label: "DataForSEO Login (email)",
    placeholder: "you@example.com",
    hint: "Your DataForSEO account email.",
    link: "https://dataforseo.com",
  },
  {
    key: "dataforseo_password",
    label: "DataForSEO Password",
    placeholder: "••••••••••••••••",
    hint: "Your DataForSEO account password.",
    link: "https://dataforseo.com",
  },
  {
    key: "anthropic",
    label: "Anthropic API Key",
    placeholder: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    hint: "Used by Claude to design and generate the PDF report.",
    link: "https://console.anthropic.com",
  },
];

export default function SettingsPage() {
  const [keys, setKeys] = useState<Keys>({ firecrawl: "", dataforseo_login: "", dataforseo_password: "", anthropic: "" });
  const [show, setShow] = useState<Record<keyof Keys, boolean>>({ firecrawl: false, dataforseo_login: false, dataforseo_password: false, anthropic: false });
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="min-h-screen">
      <nav className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-4">
        <Link href="/" className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-all">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2">
          <Key size={16} className="text-violet-400" />
          <span className="font-semibold text-white">API Keys</span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
          <p className="text-zinc-500 text-sm">Your keys are stored locally in the browser — never sent anywhere except the respective APIs.</p>
        </div>

        <div className="space-y-4">
          {fields.map(f => (
            <div key={f.key} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-zinc-200">{f.label}</label>
                <a href={f.link} target="_blank" rel="noreferrer" className="text-xs text-zinc-600 hover:text-violet-400 flex items-center gap-1 transition-colors">
                  Get key <ExternalLink size={10} />
                </a>
              </div>
              <p className="text-xs text-zinc-600 mb-3">{f.hint}</p>
              <div className="relative">
                <input
                  type={show[f.key] ? "text" : "password"}
                  value={keys[f.key]}
                  onChange={e => setKeys(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-3 pr-11 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-violet-500/50 transition-all"
                />
                <button onClick={() => toggleShow(f.key)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors">
                  {show[f.key] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {keys[f.key] && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-500">
                  <CheckCircle size={11} /> Set
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={save}
          disabled={!allFilled}
          className="mt-6 w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saved ? <><CheckCircle size={16} /> Saved!</> : <><Save size={16} /> Save Keys</>}
        </button>

        {!allFilled && (
          <p className="text-center text-xs text-zinc-600 mt-3">Fill all fields to save.</p>
        )}
      </main>
    </div>
  );
}
