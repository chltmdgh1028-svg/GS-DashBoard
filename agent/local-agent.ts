import fs from "node:fs/promises";
import crypto from "node:crypto";
import zlib from "node:zlib";
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
const defaultCentralServer = process.env.CENTRAL_SERVER_URL || "https://gs-dash-board.vercel.app";
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
  force?: boolean;
}

interface SnapshotPackage {
  scan: Awaited<ReturnType<typeof scanFolder>>;
  rawSizeBytes: number;
  gzipSizeBytes: number;
  gzipBase64: string;
}

interface AgentConfig {
  folderPath?: string;
  lastSyncAt?: string;
  lastSyncFiles?: Record<string, { name: string; modifiedAt: string; hash: string }>;
}

function defaultAgentConfig(): AgentConfig {
  return { folderPath: process.env.LOCAL_INPUT_DIR ? path.resolve(defaultInputDir) : "" };
}

async function readAgentConfig(): Promise<AgentConfig> {
  try {
    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as Partial<AgentConfig>;
    return {
      ...defaultAgentConfig(),
      ...config,
      folderPath: config.folderPath ? path.resolve(config.folderPath) : "",
    };
  } catch {
    return defaultAgentConfig();
  }
}

async function writeAgentConfig(config: AgentConfig) {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ ...config, folderPath: config.folderPath ? path.resolve(config.folderPath) : "" }, null, 2));
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
  const folderPath = inputFolder || agentConfig.folderPath ? path.resolve(inputFolder || agentConfig.folderPath || "") : "";
  const folderConfigured = Boolean(folderPath);
  if (!folderConfigured) {
    return {
      folderPath,
      folderConfigured,
      connected: false,
      files: buildStatuses(new Map(), agentConfig),
      missingRoles: requiredCampaignFileRoles,
      selectedFiles: [],
      selectedByRole: {},
      changedSinceLastSync: Boolean(agentConfig.lastSyncFiles),
      rejected: [],
    };
  }
  const connected = await folderExists(folderPath);
  const selected = new Map<FileRole, ScanCandidate>();
  const rejected: { name: string; role: FileRole | "error"; reason?: string; modifiedAt?: string }[] = [];

  if (!connected) {
    return {
      folderPath,
      folderConfigured,
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
  return { folderPath, folderConfigured, connected, files: buildStatuses(selected, agentConfig), missingRoles, selectedFiles, selectedByRole, changedSinceLastSync, rejected };
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
    "$initial = $env:AGENT_INITIAL_FOLDER",
    "if (![string]::IsNullOrWhiteSpace($initial) -and [System.IO.Directory]::Exists($initial)) { $dialog.SelectedPath = $initial }",
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

function safeErrorDetail(error: unknown) {
  const failure = error as {
    name?: string;
    message?: string;
    cause?: {
      name?: string;
      message?: string;
      code?: string;
      errno?: number;
      syscall?: string;
      hostname?: string;
      address?: string;
      port?: number;
    };
  };
  return {
    name: failure?.name,
    message: failure?.message,
    cause: failure?.cause
      ? {
          name: failure.cause.name,
          message: failure.cause.message,
          code: failure.cause.code,
          errno: failure.cause.errno,
          syscall: failure.cause.syscall,
          hostname: failure.cause.hostname,
          address: failure.cause.address,
          port: failure.cause.port,
        }
      : undefined,
  };
}

function logCentralFailure(context: {
  url: string;
  centralOrigin: string;
  method: string;
  rawSizeBytes?: number;
  gzipSizeBytes?: number;
  error: unknown;
}) {
  const detail = {
    url: context.url,
    CENTRAL_ORIGIN: [...allowedOrigins].join(","),
    centralOrigin: context.centralOrigin,
    method: context.method,
    rawSizeBytes: context.rawSizeBytes,
    gzipSizeBytes: context.gzipSizeBytes,
    error: safeErrorDetail(context.error),
  };
  console.error("중앙 서버 요청 실패 상세:");
  console.error(JSON.stringify(detail, null, 2));
  return detail;
}

async function createSnapshotPackage(config?: CampaignConfig, options: { force?: boolean } = {}): Promise<
  | ({ status: "COMPLETED" } & SnapshotPackage)
  | { status: "UNCHANGED"; scan: Awaited<ReturnType<typeof scanFolder>>; message: string }
  | { status: "FAILED"; scan: Awaited<ReturnType<typeof scanFolder>>; error: string }
> {
  const scan = await scanFolder();
  if (!scan.connected) return { status: "FAILED", error: "로컬 데이터 폴더에 접근할 수 없습니다.", scan };
  if (scan.missingRoles.length) {
    return { status: "FAILED", error: "필수 Excel 파일이 누락되어 Campaign 반영을 중단했습니다.", scan };
  }
  if (!scan.changedSinceLastSync && !options.force) {
    return { status: "UNCHANGED", scan, message: "마지막 반영 이후 변경된 파일이 없습니다." };
  }

  const files = await Promise.all(scan.selectedFiles.map((file) => inputFileFromPath(file.filePath)));
  const dataset = await parseCampaignFiles(files, mergeConfig(config));
  const rawPayload = Buffer.from(JSON.stringify({ dataset }), "utf8");
  const compressedPayload = zlib.gzipSync(rawPayload, { level: 9 });
  console.log(`Snapshot 생성: ${(rawPayload.byteLength / 1048576).toFixed(2)}MB -> gzip ${(compressedPayload.byteLength / 1048576).toFixed(2)}MB`);

  return {
    status: "COMPLETED",
    scan,
    rawSizeBytes: rawPayload.byteLength,
    gzipSizeBytes: compressedPayload.byteLength,
    gzipBase64: compressedPayload.toString("base64"),
  };
}

async function showWindowsMessage(title: string, message: string) {
  if (process.platform !== "win32" || process.env.AGENT_NO_MESSAGE_BOX === "1") return;
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    `[System.Windows.Forms.MessageBox]::Show('${message.replace(/'/g, "''")}', '${title.replace(/'/g, "''")}') | Out-Null`,
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: false }).catch(() => undefined);
}

async function existingAgentHealth() {
  try {
    const response = await fetch(`http://${host}:${port}/health`);
    return response.ok;
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
  const folderPath = agentConfig.folderPath || "";
  res.json({
    ok: true,
    agentVersion,
    folderPath,
    folderConfigured: Boolean(folderPath),
    folderConnected: folderPath ? await folderExists(folderPath) : false,
    lastSyncAt: agentConfig.lastSyncAt,
    centralServer: defaultCentralServer,
    allowedOrigins: [...allowedOrigins],
    allowedOriginPattern: allowedOriginPattern.source,
  });
});

app.get("/config", async (_req, res) => {
  const agentConfig = await readAgentConfig();
  res.json({
    folderPath: agentConfig.folderPath || "",
    lastSyncAt: agentConfig.lastSyncAt,
  });
});

app.post("/config", async (req, res) => {
  const folderPath = typeof req.body?.folderPath === "string" ? req.body.folderPath.trim() : "";
  if (!folderPath) return res.status(400).json({ error: "폴더 경로를 입력하세요." });
  const resolved = path.resolve(folderPath);
  if (!(await folderExists(resolved))) {
    return res.status(400).json({ error: "입력한 경로가 존재하는 폴더가 아닙니다." });
  }
  const nextConfig = { ...(await readAgentConfig()), folderPath: resolved };
  await writeAgentConfig(nextConfig);
  res.json({
    folderPath: nextConfig.folderPath,
    folderConnected: await folderExists(nextConfig.folderPath),
    lastSyncAt: nextConfig.lastSyncAt,
  });
});

app.post("/select-folder", async (_req, res) => {
  const currentConfig = await readAgentConfig();
  try {
    const selected = await openFolderPicker(currentConfig.folderPath || "");
    if (!selected.supported) return res.status(501).json({ error: "Windows 폴더 선택 UI는 Windows Agent에서만 지원합니다. 경로 직접 입력을 사용하세요." });
    if (!selected.selectedPath) return res.json({ canceled: true, folderPath: currentConfig.folderPath || "" });
    const resolved = path.resolve(selected.selectedPath);
    if (!(await folderExists(resolved))) return res.status(400).json({ error: "선택한 경로가 존재하는 폴더가 아닙니다." });
    const nextConfig = { ...currentConfig, folderPath: resolved };
    await writeAgentConfig(nextConfig);
    res.json({
      canceled: false,
      folderPath: nextConfig.folderPath,
      folderConnected: await folderExists(nextConfig.folderPath),
      lastSyncAt: nextConfig.lastSyncAt,
    });
  } catch (error) {
    const detail = safeErrorDetail(error);
    console.error("Windows 폴더 선택 실패 상세:");
    console.error(JSON.stringify(detail, null, 2));
    res.status(500).json({
      error: "Windows 폴더 선택창을 열지 못했습니다. 경로 직접 입력을 사용하세요.",
      detail,
    });
  }
});

app.get("/files", async (req, res) => {
  const scan = await scanFolder(typeof req.query.folderPath === "string" ? req.query.folderPath : undefined);
  res.json(scan);
});

app.post("/snapshot", async (req, res) => {
  const body = req.body as SyncBody;
  if (!body.token) return res.status(401).json({ status: "FAILED", error: "Sync Token이 없습니다." });

  try {
    const snapshot = await createSnapshotPackage(body.config, { force: body.force });
    if (snapshot.status === "FAILED") return res.status(400).json(snapshot);
    res.json(snapshot);
  } catch (error) {
    const detail = safeErrorDetail(error);
    console.error("Snapshot 생성 실패 상세:");
    console.error(JSON.stringify(detail, null, 2));
    res.status(500).json({
      status: "FAILED",
      error: error instanceof Error ? error.message : "Local Agent Snapshot 생성 실패",
      detail,
    });
  }
});

app.post("/sync-complete", async (req, res) => {
  const selectedByRole = req.body?.selectedByRole;
  if (!selectedByRole || typeof selectedByRole !== "object") {
    return res.status(400).json({ error: "반영 완료 파일 정보가 없습니다." });
  }
  const nextConfig = await readAgentConfig();
  await writeAgentConfig({
    ...nextConfig,
    lastSyncAt: new Date().toISOString(),
    lastSyncFiles: selectedByRole,
  });
  res.json({ ok: true });
});

app.post("/sync", async (req, res) => {
  const body = req.body as SyncBody;
  if (!validateCentralUrl(body.centralUrl, req.headers.origin)) {
    return res.status(403).json({ status: "FAILED", error: "중앙 Dashboard 주소가 허용 목록과 일치하지 않습니다." });
  }
  if (!body.token) return res.status(401).json({ status: "FAILED", error: "Sync Token이 없습니다." });

  try {
    const snapshot = await createSnapshotPackage(body.config, { force: body.force });
    if (snapshot.status === "FAILED") return res.status(400).json(snapshot);
    if (snapshot.status === "UNCHANGED") return res.json(snapshot);

    const uploadUrl = `${body.centralUrl}/api/admin/campaigns/local-sync`;
    console.log(`Snapshot 전송: ${(snapshot.rawSizeBytes / 1048576).toFixed(2)}MB -> gzip ${(snapshot.gzipSizeBytes / 1048576).toFixed(2)}MB`);
    const rawPayload = Buffer.from(JSON.stringify({ token: body.token, dataset: JSON.parse(zlib.gunzipSync(Buffer.from(snapshot.gzipBase64, "base64")).toString("utf8")).dataset }), "utf8");
    const compressedPayload = zlib.gzipSync(rawPayload, { level: 9 });

    let centralResponse: Response;
    try {
      centralResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: compressedPayload,
      });
    } catch (error) {
      const detail = logCentralFailure({
        url: uploadUrl,
        centralOrigin: body.centralUrl ?? "",
        method: "POST",
        rawSizeBytes: rawPayload.byteLength,
        gzipSizeBytes: compressedPayload.byteLength,
        error,
      });
      return res.status(502).json({
        status: "FAILED",
        error: "Local Agent가 Dashboard 서버에 연결하지 못했습니다.",
        detail,
      });
    }
    const central = (await centralResponse.json().catch(() => ({}))) as { error?: string };
    if (!centralResponse.ok) {
      const reason =
        central.error ||
        (centralResponse.status === 413
          ? `중앙 서버가 요청 크기를 거부했습니다 (gzip ${(compressedPayload.byteLength / 1048576).toFixed(2)}MB).`
          : `중앙 서버 반영 실패 (HTTP ${centralResponse.status})`);
      return res.status(centralResponse.status).json({ status: "FAILED", error: reason, scan: snapshot.scan });
    }

    const nextConfig = await readAgentConfig();
    await writeAgentConfig({
      ...nextConfig,
      lastSyncAt: new Date().toISOString(),
      lastSyncFiles: snapshot.scan.selectedByRole,
    });

    res.json({ status: "COMPLETED", scan: snapshot.scan, central });
  } catch (error) {
    const detail = safeErrorDetail(error);
    console.error("Local Agent 처리 실패 상세:");
    console.error(JSON.stringify(detail, null, 2));
    res.status(500).json({ status: "FAILED", error: error instanceof Error ? error.message : "Local Agent 처리 실패", detail });
  }
});

async function startAgent() {
  if (await existingAgentHealth()) {
    const message = `GS Dashboard Local Agent가 이미 실행 중입니다.\n주소: http://${host}:${port}`;
    console.log(message);
    await showWindowsMessage("GS Dashboard Agent", message);
    return;
  }

  const server = app.listen(port, host, () => {
    console.log("========================================");
    console.log(`GS Dashboard Local Agent ${agentVersion}`);
    console.log(`상태: 실행 중`);
    console.log(`주소: http://${host}:${port}`);
    console.log(`중앙 서버: ${defaultCentralServer}`);
    console.log(`종료: 이 창에서 Ctrl+C 또는 창 닫기`);
    console.log("========================================");
    void readAgentConfig().then((config) => console.log(`연결 폴더: ${config.folderPath}`));
  });

  server.on("error", async (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      const message = `GS Dashboard Local Agent가 이미 실행 중이거나 ${port} 포트를 사용 중입니다.`;
      console.log(message);
      await showWindowsMessage("GS Dashboard Agent", message);
      process.exitCode = 0;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
}

void startAgent();
