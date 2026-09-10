import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import { defaultCampaignConfig } from "../src/config/defaultConfig.js";
import { fileRoleLabels, optionalCampaignFileRoles, requiredCampaignFileRoles } from "../src/domain/fileRoles.js";
import type { CampaignConfig, FileRole } from "../src/domain/types.js";
import { classifyCampaignInputFile, parseCampaignFiles, type CampaignInputFile } from "../src/parsers/excel.js";

const agentVersion = "0.2.0";
const host = process.env.AGENT_HOST || "127.0.0.1";
const port = Number(process.env.AGENT_PORT || 8787);
const defaultInputDir = process.env.LOCAL_INPUT_DIR || "C:\\GS-Dashboard\\Input";
const configDir = process.env.AGENT_CONFIG_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "GS-Dashboard-Agent");
const configPath = path.join(configDir, "config.json");
const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://gs-dash-board.vercel.app",
];
const allowedOrigins = new Set((process.env.CENTRAL_ORIGIN || defaultAllowedOrigins.join(",")).split(",").map((origin) => origin.trim()).filter(Boolean));
const allowedOriginPattern = process.env.CENTRAL_ORIGIN_PATTERN
  ? new RegExp(process.env.CENTRAL_ORIGIN_PATTERN)
  : /^https:\/\/gs-dash-board(?:-[a-z0-9-]+)?\.vercel\.app$/;
const execFileAsync = promisify(execFile);

interface ScanCandidate {
  role: FileRole;
  name: string;
  filePath: string;
  modifiedAt: string;
  modifiedMs: number;
  hash: string;
}

interface SyncBody {
  centralUrl?: string;
  token?: string;
  config?: CampaignConfig;
}

interface AgentConfig {
  folderPath: string;
  lastSyncAt?: string;
  lastSyncFiles?: Record<string, { name: string; modifiedAt: string; hash: string }>;
}

function defaultAgentConfig(): AgentConfig {
  return { folderPath: path.resolve(defaultInputDir) };
}

async function readAgentConfig(): Promise<AgentConfig> {
  try {
    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as Partial<AgentConfig>;
    return {
      ...defaultAgentConfig(),
      ...config,
      folderPath: path.resolve(config.folderPath || defaultInputDir),
    };
  } catch {
    return defaultAgentConfig();
  }
}

async function writeAgentConfig(config: AgentConfig) {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ ...config, folderPath: path.resolve(config.folderPath) }, null, 2));
}

function arrayBufferFromBuffer(buffer: Buffer) {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

async function inputFileFromPath(filePath: string): Promise<CampaignInputFile> {
  const name = path.basename(filePath);
  return {
    name,
    arrayBuffer: async () => arrayBufferFromBuffer(await fs.readFile(filePath)),
  };
}

async function hashFile(filePath: string) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function folderExists(folderPath: string) {
  try {
    return (await fs.stat(folderPath)).isDirectory();
  } catch {
    return false;
  }
}

async function scanFolder(inputFolder?: string) {
  const agentConfig = await readAgentConfig();
  const folderPath = path.resolve(inputFolder || agentConfig.folderPath);
  const connected = await folderExists(folderPath);
  const selected = new Map<FileRole, ScanCandidate>();
  const rejected: { name: string; role: FileRole | "error"; reason?: string; modifiedAt?: string }[] = [];

  if (!connected) {
    return {
      folderPath,
      connected,
      files: buildStatuses(selected, agentConfig),
      missingRoles: requiredCampaignFileRoles,
      selectedFiles: [],
      selectedByRole: {},
      changedSinceLastSync: Boolean(agentConfig.lastSyncFiles),
      rejected,
    };
  }

  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const excelEntries = entries.filter((entry) => entry.isFile() && /\.(xlsx|xlsm|xlsb|xls)$/i.test(entry.name) && !entry.name.startsWith("~$"));

  for (const entry of excelEntries) {
    const filePath = path.join(folderPath, entry.name);
    try {
      const stat = await fs.stat(filePath);
      const inputFile = await inputFileFromPath(filePath);
      const role = await classifyCampaignInputFile(inputFile);
      const hash = await hashFile(filePath);
      if (role === "unknown" || role === "reference") {
        rejected.push({ name: entry.name, role, modifiedAt: stat.mtime.toISOString() });
        continue;
      }
      const candidate = { role, name: entry.name, filePath, modifiedAt: stat.mtime.toISOString(), modifiedMs: stat.mtimeMs, hash };
      const existing = selected.get(role);
      if (!existing || candidate.modifiedMs > existing.modifiedMs) selected.set(role, candidate);
    } catch (error) {
      rejected.push({ name: entry.name, role: "error", reason: error instanceof Error ? error.message : "파일 분석 실패" });
    }
  }

  const missingRoles = requiredCampaignFileRoles.filter((role) => !selected.has(role));
  const selectedByRole = Object.fromEntries(
    [...selected.values()].map((file) => [
      file.role,
      { name: file.name, modifiedAt: file.modifiedAt, hash: file.hash },
    ]),
  ) as Partial<Record<FileRole, { name: string; modifiedAt: string; hash: string }>>;
  const changedSinceLastSync = [...requiredCampaignFileRoles, ...optionalCampaignFileRoles].some((role) => {
    const current = selectedByRole[role];
    const previous = agentConfig.lastSyncFiles?.[role];
    return current?.hash !== previous?.hash;
  });
  const selectedFiles = [...requiredCampaignFileRoles, ...optionalCampaignFileRoles].flatMap((role) => {
    const file = selected.get(role);
    return file ? [file] : [];
  });
  return { folderPath, connected, files: buildStatuses(selected, agentConfig), missingRoles, selectedFiles, selectedByRole, changedSinceLastSync, rejected };
}

function buildStatuses(selected: Map<FileRole, ScanCandidate>, agentConfig: AgentConfig) {
  return [...requiredCampaignFileRoles, ...optionalCampaignFileRoles].map((role) => {
    const file = selected.get(role);
    const previous = agentConfig.lastSyncFiles?.[role];
    const changed = file?.hash !== previous?.hash;
    return {
      role,
      label: fileRoleLabels[role],
      found: Boolean(file),
      name: file?.name,
      modifiedAt: file?.modifiedAt,
      hash: file?.hash,
      changed,
    };
  });
}

async function openFolderPicker(initialFolder: string) {
  if (process.platform !== "win32") return { supported: false, selectedPath: "" };
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'GS Dashboard 데이터 폴더 선택'",
    "$dialog.SelectedPath = $env:AGENT_INITIAL_FOLDER",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: { ...process.env, AGENT_INITIAL_FOLDER: initialFolder },
    windowsHide: false,
  });
  return { supported: true, selectedPath: stdout.trim() };
}

function mergeConfig(config: CampaignConfig | undefined): CampaignConfig {
  return { ...structuredClone(defaultCampaignConfig), ...(config ?? {}) };
}

function validateOrigin(req: express.Request, res: express.Response) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!isAllowedOrigin(origin)) {
    res.status(403).json({ error: "허용되지 않은 Dashboard Origin입니다." });
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return true;
}

function isAllowedOrigin(origin: string) {
  return allowedOrigins.has(origin) || allowedOriginPattern.test(origin);
}

function validateCentralUrl(centralUrl: string | undefined, origin: string | undefined) {
  if (!centralUrl) return false;
  try {
    const parsed = new URL(centralUrl);
    return isAllowedOrigin(parsed.origin) && (!origin || parsed.origin === origin);
  } catch {
    return false;
  }
}

const app = express();
app.use(express.json({ limit: "160mb" }));
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    if (!validateOrigin(req, res)) return;
    return res.status(204).end();
  }
  if (!validateOrigin(req, res)) return;
  next();
});

app.get("/health", async (_req, res) => {
  const agentConfig = await readAgentConfig();
  res.json({
    ok: true,
    agentVersion,
    folderPath: agentConfig.folderPath,
    folderConnected: await folderExists(agentConfig.folderPath),
    lastSyncAt: agentConfig.lastSyncAt,
    allowedOrigins: [...allowedOrigins],
    allowedOriginPattern: allowedOriginPattern.source,
  });
});

app.get("/config", async (_req, res) => {
  const agentConfig = await readAgentConfig();
  res.json({
    folderPath: agentConfig.folderPath,
    lastSyncAt: agentConfig.lastSyncAt,
  });
});

app.post("/config", async (req, res) => {
  const folderPath = typeof req.body?.folderPath === "string" ? req.body.folderPath.trim() : "";
  if (!folderPath) return res.status(400).json({ error: "폴더 경로를 입력하세요." });
  const nextConfig = { ...(await readAgentConfig()), folderPath: path.resolve(folderPath) };
  await writeAgentConfig(nextConfig);
  res.json({
    folderPath: nextConfig.folderPath,
    folderConnected: await folderExists(nextConfig.folderPath),
    lastSyncAt: nextConfig.lastSyncAt,
  });
});

app.post("/select-folder", async (_req, res) => {
  const currentConfig = await readAgentConfig();
  const selected = await openFolderPicker(currentConfig.folderPath);
  if (!selected.supported) return res.status(501).json({ error: "Windows 폴더 선택 UI는 Windows Agent에서만 지원합니다." });
  if (!selected.selectedPath) return res.json({ canceled: true, folderPath: currentConfig.folderPath });
  const nextConfig = { ...currentConfig, folderPath: path.resolve(selected.selectedPath) };
  await writeAgentConfig(nextConfig);
  res.json({
    canceled: false,
    folderPath: nextConfig.folderPath,
    folderConnected: await folderExists(nextConfig.folderPath),
    lastSyncAt: nextConfig.lastSyncAt,
  });
});

app.get("/files", async (req, res) => {
  const scan = await scanFolder(typeof req.query.folderPath === "string" ? req.query.folderPath : undefined);
  res.json(scan);
});

app.post("/sync", async (req, res) => {
  const body = req.body as SyncBody;
  if (!validateCentralUrl(body.centralUrl, req.headers.origin)) {
    return res.status(403).json({ status: "FAILED", error: "중앙 Dashboard 주소가 허용 목록과 일치하지 않습니다." });
  }
  if (!body.token) return res.status(401).json({ status: "FAILED", error: "Sync Token이 없습니다." });

  try {
    const scan = await scanFolder();
    if (!scan.connected) return res.status(400).json({ status: "FAILED", error: "로컬 데이터 폴더에 접근할 수 없습니다.", scan });
    if (scan.missingRoles.length) {
      return res.status(400).json({ status: "FAILED", error: "필수 Excel 파일이 누락되어 Campaign 반영을 중단했습니다.", scan });
    }
    if (!scan.changedSinceLastSync) {
      return res.json({ status: "UNCHANGED", scan, message: "마지막 반영 이후 변경된 파일이 없습니다." });
    }

    const files = await Promise.all(scan.selectedFiles.map((file) => inputFileFromPath(file.filePath)));
    const dataset = await parseCampaignFiles(files, mergeConfig(body.config));
    const centralResponse = await fetch(`${body.centralUrl}/api/admin/campaigns/local-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: body.token, dataset }),
    });
    const central = (await centralResponse.json().catch(() => ({}))) as { error?: string };
    if (!centralResponse.ok) {
      return res.status(centralResponse.status).json({ status: "FAILED", error: central.error || "중앙 서버 반영 실패", scan });
    }

    const nextConfig = await readAgentConfig();
    await writeAgentConfig({
      ...nextConfig,
      lastSyncAt: new Date().toISOString(),
      lastSyncFiles: scan.selectedByRole,
    });

    res.json({ status: "COMPLETED", scan, central });
  } catch (error) {
    res.status(500).json({ status: "FAILED", error: error instanceof Error ? error.message : "Local Agent 처리 실패" });
  }
});

app.listen(port, host, () => {
  console.log(`GS Dashboard Local Agent ${agentVersion} running at http://${host}:${port}`);
  void readAgentConfig().then((config) => console.log(`Input folder: ${config.folderPath}`));
});
