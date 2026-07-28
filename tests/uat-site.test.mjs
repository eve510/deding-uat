import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("UAT plan contains six distinct task forces and the full case set", async () => {
  const markdown = await readFile(new URL("public/uat-plan.md", root), "utf8");
  const staffSections = markdown.match(/^# 員工 [A-F] 專屬測試任務清單$/gm) ?? [];
  const cases = markdown.match(/^### [A-F]-\d{2} /gm) ?? [];
  const proposals = markdown.match(/^- \[ \] \*\*[A-F]-I\d{2} /gm) ?? [];

  assert.equal(staffSections.length, 6);
  assert.equal(cases.length, 42);
  assert.equal(proposals.length, 18);
  assert.match(markdown, /4311-9522-2222-2222/);
  assert.match(markdown, /3D 驗證碼/);
});

test("site exposes employee reporting and engineering closure workflow", async () => {
  const source = await readFile(new URL("app/page.tsx", root), "utf8");
  const html = await readFile(new URL("out/index.html", root), "utf8");

  assert.match(source, /ENGINEERING CONTROL ROOM/);
  assert.match(source, /工程師已完成修正/);
  assert.match(source, /QA 複測通過並關閉/);
  assert.match(source, /incoming\.engineering/);
  assert.match(html, /Deding UAT Lab/);
});
