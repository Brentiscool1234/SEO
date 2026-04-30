const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const PORT = 3000;
const DEV = process.env.NODE_ENV === "development";

let mainWindow = null;
let nextProcess = null;
let tray = null;

// Wait until Next.js server responds
function waitForServer(url, retries = 30, delay = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode < 500) return resolve();
        retry();
      }).on("error", retry);
    };
    const retry = () => {
      attempts++;
      if (attempts >= retries) return reject(new Error("Server did not start in time"));
      setTimeout(check, delay);
    };
    check();
  });
}

function startNextServer() {
  const nextBin = path.join(process.resourcesPath || "", "app", "node_modules", ".bin", "next");
  const appDir = path.join(process.resourcesPath || "", "app");

  const cmd = DEV ? "npm" : nextBin;
  const args = DEV ? ["run", "dev"] : ["start", "--port", String(PORT)];
  const cwd = DEV ? path.join(__dirname, "..") : appDir;

  nextProcess = spawn(cmd, args, {
    cwd,
    shell: true,
    env: { ...process.env, PORT: String(PORT) },
  });

  nextProcess.stdout.on("data", (d) => console.log("[next]", d.toString().trim()));
  nextProcess.stderr.on("data", (d) => console.error("[next]", d.toString().trim()));
  nextProcess.on("exit", (code) => console.log("[next] exited with code", code));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0a0f",
      symbolColor: "#ffffff",
      height: 36,
    },
    backgroundColor: "#0a0a0f",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    icon: path.join(__dirname, "icon.ico"),
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.loadURL(`http://localhost:${PORT}`);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "icon.ico"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: "Open SEO Audit", click: () => mainWindow ? mainWindow.focus() : createWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setToolTip("SEO Audit Tool");
  tray.setContextMenu(menu);
  tray.on("double-click", () => mainWindow ? mainWindow.focus() : createWindow());
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  // Show a loading window immediately
  const loader = new BrowserWindow({
    width: 420,
    height: 240,
    frame: false,
    backgroundColor: "#0a0a0f",
    resizable: false,
    center: true,
    webPreferences: { nodeIntegration: false },
  });
  loader.loadURL(`data:text/html,<!DOCTYPE html>
<html>
<head><style>
  body { margin:0; background:#0a0a0f; color:#fff; font-family:-apple-system,sans-serif;
         display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; }
  .logo { width:48px; height:48px; background:linear-gradient(135deg,#7c3aed,#4f46e5);
          border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:22px; }
  h2 { margin:0; font-size:18px; font-weight:600; }
  p { margin:0; color:#71717a; font-size:13px; }
  .dot { animation:blink 1.4s infinite; }
  .dot:nth-child(2) { animation-delay:.2s; }
  .dot:nth-child(3) { animation-delay:.4s; }
  @keyframes blink { 0%,80%,100%{opacity:0} 40%{opacity:1} }
</style></head>
<body>
  <div class="logo">⚡</div>
  <h2>SEO Audit Tool</h2>
  <p>Starting server<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>
</body>
</html>`);

  if (!DEV) startNextServer();

  try {
    await waitForServer(`http://localhost:${PORT}`, 60, 1000);
  } catch (e) {
    console.error("Server failed to start:", e);
  }

  loader.close();
  createWindow();
  createTray();
});

app.on("window-all-closed", (e) => {
  // Keep alive in tray on Windows
  e.preventDefault();
});

app.on("before-quit", () => {
  if (nextProcess) nextProcess.kill();
  if (tray) tray.destroy();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
