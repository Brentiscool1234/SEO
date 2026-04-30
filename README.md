# SEO Audit Tool

Automated SEO audits powered by Firecrawl, DataForSEO, and Claude. Enter URLs, get a professional PDF report.

---

## Windows — Download Installer (.exe)

The easiest way: **push a tag** and GitHub Actions builds the installer automatically.

```bash
git tag v1.0.0
git push origin v1.0.0
```

Then go to **Actions → Build Windows Installer** → download `SEO-Audit-Setup.exe` from the artifacts (or Releases if you pushed a tag).

The installer:
- Creates a Start Menu shortcut
- Creates a Desktop shortcut
- Includes an uninstaller

> **No Node.js required on the end user's machine** — everything is bundled.

---

## Build Locally (requires Windows or cross-compile)

```bash
npm install
npm run build:win      # outputs dist/SEO Audit Tool Setup.exe
```

---

## Dev Mode (any platform)

```bash
npm install
npm run electron:dev   # starts Next.js + Electron together
```

---

## First Time (after install)

1. Open **SEO Audit Tool** from your desktop
2. Click **Settings** (top right)
3. Enter your API keys:
   - **Firecrawl** — [firecrawl.dev](https://firecrawl.dev)
   - **DataForSEO** login + password — [dataforseo.com](https://dataforseo.com)
   - **Anthropic** — [console.anthropic.com](https://console.anthropic.com)
4. Click **Save Keys**

---

## Running an Audit

1. Paste one or more URLs on the dashboard
2. Click **Run Audit**
3. Watch 4-step progress: Crawl → Audit → Report → PDF
4. Download the PDF when done

---

## How It Works

| Step | API | What happens |
|---|---|---|
| Crawl | Firecrawl | Discovers all pages on the domain (up to 50) |
| Audit | DataForSEO On-Page | Checks titles, meta, H1s, load time, links, score per page |
| Report | Claude (claude-sonnet-4-6) | Designs a polished HTML report from all the data |
| PDF | Puppeteer | Renders the HTML to a print-ready PDF |

---

## Adding Your Own Icon

Place these in `electron/build/` and `electron/`:
- `icon.ico` — Windows (256×256 multi-size ICO)
- `icon.icns` — macOS
- `icon.png` — Linux (512×512)

See `electron/build/README.md` for details.
