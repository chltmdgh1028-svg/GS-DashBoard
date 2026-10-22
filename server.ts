import path from "node:path";
import express from "express";
import { createApp } from "./server/app.js";

const port = Number(process.env.PORT || 8080);
const app = createApp();

app.use(express.static(path.join(process.cwd(), "dist")));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(process.cwd(), "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`검품 마스터 콘솔 서버가 http://localhost:${port} 에서 실행 중입니다.`);
});
