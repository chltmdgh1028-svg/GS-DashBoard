import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { exec as pkgExec } from "@yao-pkg/pkg";

const root = process.cwd();
const outDir = path.join(root, "dist-agent");
const bundlePath = path.join(outDir, "agent-bundle.cjs");
const exePath = path.join(outDir, "GS-Dashboard-Agent.exe");
const readmePath = path.join(outDir, "README.txt");

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "agent", "local-agent.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: bundlePath,
});

await pkgExec([
  bundlePath,
  "--targets",
  "node24-win-x64",
  "--output",
  exePath,
  "--compress",
  "GZip",
]);

await fs.writeFile(
  readmePath,
  [
    "GS Dashboard Local Agent",
    "",
    "사용 방법",
    "1. 회사 시스템에서 받은 Excel 파일 10종을 한 폴더에 저장합니다.",
    "2. GS-Dashboard-Agent.exe를 더블클릭해 실행합니다.",
    "3. 웹 Dashboard에 ADMIN으로 로그인합니다.",
    "4. 데이터 입력 화면에서 [폴더 선택]을 눌러 Excel 폴더를 선택합니다.",
    "5. [다시 확인]으로 최신자료를 확인합니다.",
    "6. 데이터 검증 후 [Campaign 반영]을 클릭합니다.",
    "",
    "기본 Agent 주소: http://127.0.0.1:8787",
    "설정 저장 위치: %LOCALAPPDATA%\\GS-Dashboard-Agent\\config.json",
    "종료 방법: Agent 콘솔창에서 Ctrl+C를 누르거나 창을 닫습니다.",
    "",
    "보안",
    "- 이 실행파일 안에는 회사 Excel, Snapshot, 토큰, 환경변수, 원시데이터가 포함되어 있지 않습니다.",
    "- Agent는 기본적으로 127.0.0.1에만 bind합니다.",
    "- 허용된 GS Dashboard Origin과 one-time Sync Token이 있어야 Campaign 반영이 가능합니다.",
    "",
  ].join("\r\n"),
  "utf8",
);

const stat = await fs.stat(exePath);
console.log(JSON.stringify({
  exePath,
  readmePath,
  sizeMb: Number((stat.size / 1024 / 1024).toFixed(2)),
}, null, 2));
