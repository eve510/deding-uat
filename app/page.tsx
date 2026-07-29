"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type CaseStatus = "pending" | "pass" | "fail" | "blocked";

type UatCase = {
  id: string;
  title: string;
  goal: string;
  steps: string[];
  expected: string[];
};

type IdeaPrompt = {
  id: string;
  title: string;
  prompt: string;
};

type StaffPack = {
  id: string;
  name: string;
  force: string;
  environment: string;
  precondition: string;
  cases: UatCase[];
  ideaTheme: string;
  ideas: IdeaPrompt[];
};

type CaseRecord = {
  done: boolean;
  status: CaseStatus;
  feedback: string;
  severity: string;
  evidence: string;
  attachments: AttachmentRecord[];
  failureStep?: string;
};

type AttachmentRecord = { name: string; size: number; type: string; lastModified: number; dataUrl?: string };

function readAttachment(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? "")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}

type IdeaRecord = {
  response: string;
  priority: string;
  effort: string;
};

type EngineeringRecord = {
  status: "unreviewed" | "confirmed" | "fixing" | "fixed" | "retest" | "closed";
  owner: string;
  note: string;
  reference: string;
  fixed: boolean;
  retestPassed: boolean;
};

type WorkspaceState = {
  cases: Record<string, CaseRecord>;
  ideas: Record<string, IdeaRecord>;
  scores: Record<string, Record<string, number>>;
  engineering: Record<string, EngineeringRecord>;
  updatedAt?: string;
};

const STORAGE_KEY = "deding-uat-workspace-v1";
const staffColors: Record<string, string> = {
  A: "#ff7a45",
  B: "#6d5dfc",
  C: "#14a6a1",
  D: "#2e7be5",
  E: "#d44a77",
  F: "#d79922",
};

const scoreDimensions = [
  "入口與流程清楚度",
  "表單填寫效率",
  "文字與錯誤提示",
  "付款與個資信任感",
  "中斷後恢復能力",
  "整體推薦意願",
];

const blankState: WorkspaceState = { cases: {}, ideas: {}, scores: {}, engineering: {} };

const caseStatusLabels: Record<CaseStatus, string> = { pending: "未判定", pass: "通過", fail: "失敗", blocked: "阻塞" };
const severityLabels: Record<string, string> = {
  Critical: "嚴重（Critical）",
  High: "高（High）",
  Medium: "中（Medium）",
  Low: "低（Low）",
};

function cleanInline(value: string) {
  return value
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .trim();
}

function extractNumbered(block: string) {
  return block
    .split("\n")
    .map((line) => line.match(/^\s*\d+\.\s+(.+)$/)?.[1])
    .filter(Boolean)
    .map((line) => cleanInline(line as string));
}

function extractBullets(block: string) {
  return block
    .split("\n")
    .map((line) => line.match(/^\s{2,}-\s+(.+)$/)?.[1])
    .filter(Boolean)
    .map((line) => cleanInline(line as string));
}

function parsePlan(markdown: string): StaffPack[] {
  const ids = ["A", "B", "C", "D", "E", "F"];
  return ids.map((id, index) => {
    const start = markdown.indexOf(`# 員工 ${id} `);
    const nextMarker = index < ids.length - 1 ? `# 員工 ${ids[index + 1]} ` : "## 5. QA Manager";
    const end = markdown.indexOf(nextMarker, start + 1);
    const section = markdown.slice(start, end > start ? end : undefined);
    const force = section.match(/## Task Force [A-F]：([^\n]+)/)?.[1]?.trim() ?? "測試任務";
    const environment = cleanInline(section.match(/\*\*環境\*\*：([^\n]+)/)?.[1] ?? "依 QA Manager 指定環境");
    const precondition = cleanInline(
      section.match(/\*\*(?:前置|原則|判定|安全界線)\*\*：([^\n]+)/)?.[1] ?? "使用專屬虛構測試資料。",
    );
    const cases: UatCase[] = [];
    const caseRegex = new RegExp(
      `### (${id}-\\d{2}) ([^\\n]+)\\n([\\s\\S]*?)(?=\\n### ${id}-\\d{2} |\\n## 員工 ${id} 改善|\\n---|$)`,
      "g",
    );
    for (const match of section.matchAll(caseRegex)) {
      const body = match[3];
      const stepBlock = body.split("- **操作步驟**")[1]?.split("- **預期結果**")[0] ?? "";
      const expectedBlock = body.split("- **預期結果**")[1]?.split("- **Feedback**")[0] ?? "";
      const title = match[2].trim();
      cases.push({
        id: match[1],
        title,
        goal: cleanInline(body.match(/- \*\*操作目標\*\*：([^\n]+)/)?.[1] ?? `確認「${title}」在指定情境下可順利完成，並留下足以讓工程師重現與修正的證據。`),
        steps: extractNumbered(stepBlock),
        expected: extractBullets(expectedBlock),
      });
    }
    const ideaTheme = section.match(/## 員工 [A-F] 改善提案主題：([^\n]+)/)?.[1]?.trim() ?? "改善提案";
    const ideas: IdeaPrompt[] = [];
    const ideaRegex = new RegExp(`^- \\[ \\] \\*\\*(${id}-I\\d{2}) ([^*]+)\\*\\*：(.+)$`, "gm");
    for (const match of section.matchAll(ideaRegex)) {
      ideas.push({ id: match[1], title: match[2].trim(), prompt: cleanInline(match[3]) });
    }
    return { id, name: `員工 ${id}`, force, environment, precondition, cases, ideaTheme, ideas };
  });
}

function defaultCaseRecord(): CaseRecord {
  return { done: false, status: "pending", feedback: "", severity: "", evidence: "", attachments: [], failureStep: "" };
}

function defaultIdeaRecord(): IdeaRecord {
  return { response: "", priority: "", effort: "" };
}

function defaultEngineeringRecord(): EngineeringRecord {
  return { status: "unreviewed", owner: "", note: "", reference: "", fixed: false, retestPassed: false };
}

export default function Home() {
  const [packs, setPacks] = useState<StaffPack[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(blankState);
  const [selectedStaff, setSelectedStaff] = useState("overview");
  const [section, setSection] = useState<"cases" | "ideas" | "guide">("cases");
  const [filter, setFilter] = useState<"all" | CaseStatus>("all");
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("./uat-plan.md?v=20260728-2").then((response) => response.text()),
      Promise.resolve(localStorage.getItem(STORAGE_KEY)),
    ])
      .then(([markdown, stored]) => {
        setPacks(parsePlan(markdown));
        if (stored) {
          const saved = JSON.parse(stored) as Partial<WorkspaceState>;
          const migratedCases = Object.fromEntries(Object.entries(saved.cases ?? {}).map(([id, raw]) => {
            const item = raw as CaseRecord;
            if (!item || !item.status || item.failureStep || item.status === "pass") return [id, item];
            const step = item.feedback?.includes("http://deding.test") ? "第 1 步" : item.feedback?.includes("前置") || item.feedback?.includes("待測試") ? "無法開始" : "完成後";
            const detail = item.feedback?.includes("【問題發生步驟】") ? item.feedback : `【問題發生步驟：${step}】\n${item.feedback ?? ""}`;
            return [id, { ...item, failureStep: step, feedback: detail }];
          }));
          setWorkspace({
            cases: migratedCases,
            ideas: saved.ideas ?? {},
            scores: saved.scores ?? {},
            engineering: saved.engineering ?? {},
            updatedAt: saved.updatedAt,
          });
        }
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const next = { ...workspace, updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, [workspace, ready]);

  const allCases = useMemo(() => packs.flatMap((pack) => pack.cases), [packs]);
  const doneCount = allCases.filter((item) => workspace.cases[item.id]?.done).length;
  const passCount = allCases.filter((item) => workspace.cases[item.id]?.status === "pass").length;
  const failCount = allCases.filter((item) => workspace.cases[item.id]?.status === "fail").length;
  const blockedCount = allCases.filter((item) => workspace.cases[item.id]?.status === "blocked").length;
  const overallPercent = allCases.length ? Math.round((doneCount / allCases.length) * 100) : 0;
  const activePack = packs.find((pack) => pack.id === selectedStaff);

  const setCaseRecord = (id: string, patch: Partial<CaseRecord>) => {
    setWorkspace((current) => ({
      ...current,
      cases: {
        ...current.cases,
        [id]: { ...(current.cases[id] ?? defaultCaseRecord()), ...patch },
      },
    }));
  };

  const setIdeaRecord = (id: string, patch: Partial<IdeaRecord>) => {
    setWorkspace((current) => ({
      ...current,
      ideas: {
        ...current.ideas,
        [id]: { ...(current.ideas[id] ?? defaultIdeaRecord()), ...patch },
      },
    }));
  };

  const setScore = (staffId: string, dimension: string, value: number) => {
    setWorkspace((current) => ({
      ...current,
      scores: {
        ...current.scores,
        [staffId]: { ...(current.scores[staffId] ?? {}), [dimension]: value },
      },
    }));
  };

  const setEngineeringRecord = (id: string, patch: Partial<EngineeringRecord>) => {
    setWorkspace((current) => ({
      ...current,
      engineering: {
        ...current.engineering,
        [id]: { ...(current.engineering?.[id] ?? defaultEngineeringRecord()), ...patch },
      },
    }));
  };

  const exportResults = () => {
    const payload = {
      project: "Deding 官網報名系統 UAT",
      version: "1.1",
      exportedAt: new Date().toISOString(),
      progress: { completed: doneCount, total: allCases.length, pass: passCount, fail: failCount, blocked: blockedCount },
      workspace,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `deding-uat-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importResults = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed.workspace?.cases || !parsed.workspace?.ideas) throw new Error("invalid");
        const incoming = parsed.workspace as Partial<WorkspaceState>;
        setWorkspace((current) => ({
          cases: { ...current.cases, ...(incoming.cases ?? {}) },
          ideas: { ...current.ideas, ...(incoming.ideas ?? {}) },
          scores: { ...current.scores, ...(incoming.scores ?? {}) },
          engineering: { ...current.engineering, ...(incoming.engineering ?? {}) },
          updatedAt: new Date().toISOString(),
        }));
      } catch {
        window.alert("無法讀取此檔案。請選擇由本工作台匯出的 JSON。");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const openStaff = (id: string) => {
    setSelectedStaff(id);
    setSection("cases");
    setFilter("all");
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!ready) {
    return (
      <main className="loading-shell">
        <div className="loading-mark">D</div>
        <p>正在載入 UAT 工作台…</p>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setSelectedStaff("overview")} aria-label="回到總覽">
          <span className="brand-mark">D</span>
          <span>
            <strong>Deding UAT Lab</strong>
            <small>上線前共同驗收工作台</small>
          </span>
        </button>
        <div className="top-actions">
          <span className="save-indicator is-saving">
            <i /> 本機自動儲存
          </span>
          <input ref={importRef} className="visually-hidden" type="file" accept="application/json" onChange={importResults} />
          <button className="ghost-button" onClick={() => importRef.current?.click()}>匯入備份</button>
          <button className="primary-button" onClick={exportResults}>匯出備份</button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="staff-rail" aria-label="任務分派">
          <button className={`rail-overview ${selectedStaff === "overview" ? "active" : ""}`} onClick={() => setSelectedStaff("overview")}>
            <span>總覽</span><strong>{overallPercent}%</strong>
          </button>
          <button className={`engineer-chip ${selectedStaff === "engineer" ? "active" : ""}`} onClick={() => setSelectedStaff("engineer")}>
            <span className="engineer-mark">⌘</span>
            <span><strong>工程統籌</strong><small>問題確認與修正追蹤</small></span>
          </button>
          {packs.map((pack) => {
            const packDone = pack.cases.filter((item) => workspace.cases[item.id]?.done).length;
            return (
              <button
                key={pack.id}
                className={`staff-chip ${selectedStaff === pack.id ? "active" : ""}`}
                style={{ "--staff-color": staffColors[pack.id] } as React.CSSProperties}
                onClick={() => openStaff(pack.id)}
              >
                <span className="staff-letter">{pack.id}</span>
                <span className="staff-chip-copy"><strong>{pack.name}</strong><small>{packDone}/{pack.cases.length} 完成</small></span>
                <span className="staff-chip-progress"><i style={{ width: `${pack.cases.length ? (packDone / pack.cases.length) * 100 : 0}%` }} /></span>
              </button>
            );
          })}
          <div className="privacy-note">
            <strong>資料存放位置</strong>
            <p>員工與工程師可直接在此畫面共同處理；資料會自動保存在目前瀏覽器。匯入／匯出僅作備份用途。</p>
          </div>
        </aside>

        <section className="content-area">
          {selectedStaff === "overview" ? (
            <Overview
              packs={packs}
              workspace={workspace}
              overallPercent={overallPercent}
              done={doneCount}
              pass={passCount}
              fail={failCount}
              blocked={blockedCount}
              onOpenStaff={openStaff}
            />
          ) : selectedStaff === "engineer" ? (
            <EngineerWorkspace packs={packs} workspace={workspace} setEngineeringRecord={setEngineeringRecord} />
          ) : activePack ? (
            <StaffWorkspace
              pack={activePack}
              workspace={workspace}
              section={section}
              setSection={setSection}
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
              setCaseRecord={setCaseRecord}
              setIdeaRecord={setIdeaRecord}
              setScore={setScore}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function Overview({ packs, workspace, overallPercent, done, pass, fail, blocked, onOpenStaff }: {
  packs: StaffPack[];
  workspace: WorkspaceState;
  overallPercent: number;
  done: number;
  pass: number;
  fail: number;
  blocked: number;
  onOpenStaff: (id: string) => void;
}) {
  const totalCases = packs.reduce((total, pack) => total + pack.cases.length, 0);
  const assignmentGuide: Record<string, { difficulty: string; skills: string }> = {
    A: { difficulty: "高", skills: "熟悉端到端報名、訂單與資料一致性" }, B: { difficulty: "中", skills: "細心、擅長欄位防呆與提示判讀" }, C: { difficulty: "高", skills: "理解多考生、成績與測驗資料邏輯" }, D: { difficulty: "中高", skills: "熟悉手機操作、RWD 與觸控觀察" }, E: { difficulty: "很高", skills: "具測試經驗，能執行中斷與破壞性操作" }, F: { difficulty: "很高", skills: "熟悉金流、訂單、會員權益與風險判斷" },
  };
  const coverageRows = [
    ["公開入口：首頁", "A-01、A-10、D-11"], ["公開內容：新聞／競賽／地點", "A-10、D-11、E-11"],
    ["公開支援：Q&A／客服", "B-11、D-08、E-08"], ["商品：書店／報名商品", "B-10、A-01"],
    ["報名：考生資料與選項組合", "A-01～A-09、B-01～B-09、C-01～C-07"],
    ["交易：購物車／結帳／付款", "A-04、A-05、B-08、B-09、F-02～F-06"],
    ["會員：會員中心／准考證", "A-06、A-11、D-09"], ["會員：成績查詢", "C-08、D-09、E-09、F-09"],
    ["測驗：線上練習入口", "C-09、F-09"], ["測驗：開始／作答／送出", "C-10、D-10"],
    ["測驗：紀錄／分數／分析", "C-11"], ["測驗：中斷／重複送出", "E-10"],
    ["測驗：點數不足與權益", "F-10"], ["測驗：權限／個資隔離", "F-11"],
  ];
  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">PRE-LAUNCH / UAT v1.1</p>
          <h1>上線前的最後一道<br /><em>共同決策。</em></h1>
          <p className="hero-lead">{totalCases} 個驗收案例，交給 6 位熟悉業務的資深同仁。除了找出問題，也把家長與考生每一次卡住、猶豫與靈感，變成下一版的修改方向。</p>
          <div className="hero-actions">
            <button className="primary-button large" onClick={() => onOpenStaff("A")}>開始執行任務</button>
            <a className="text-link" href="./uat-plan.md" download>下載完整 Markdown ↗</a>
          </div>
        </div>
        <div className="progress-orbit" style={{ "--progress": `${overallPercent * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{overallPercent}%</strong><span>整體完成度</span><small>{done} / {totalCases}</small></div>
        </div>
      </section>

      <section className="metrics-row" aria-label="UAT 統計">
        <Metric label="已完成" value={done} tone="ink" />
        <Metric label="Pass" value={pass} tone="good" />
        <Metric label="Fail" value={fail} tone="bad" />
        <Metric label="Blocked" value={blocked} tone="warn" />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">TASK FORCES</p><h2>六條不同的驗收視角</h2></div>
          <p>每位同仁 11 案＋3 個改善題目，涵蓋家長、考生與非功能操作理解，避免六個人只重複走同一條流程。</p>
        </div>
        <div className="force-grid">
          {packs.map((pack) => {
            const records = pack.cases.map((item) => workspace.cases[item.id]);
            const packDone = records.filter((record) => record?.done).length;
            const packFails = records.filter((record) => record?.status === "fail").length;
            return (
              <button key={pack.id} className="force-card" style={{ "--staff-color": staffColors[pack.id] } as React.CSSProperties} onClick={() => onOpenStaff(pack.id)}>
                <span className="force-index">0{pack.id.charCodeAt(0) - 64}</span>
                <span className="staff-letter">{pack.id}</span>
                <h3>{pack.force}</h3>
                <p>{pack.ideaTheme}</p>
                <div className="assignment-guide"><span>難易度：<b>{assignmentGuide[pack.id]?.difficulty}</b></span><small>適合能力：{assignmentGuide[pack.id]?.skills}</small></div>
                <div className="force-meta"><span>{packDone}/{pack.cases.length} 完成</span><span>{packFails ? `${packFails} 個 Fail` : "尚無 Fail"}</span></div>
                <div className="line-progress"><i style={{ width: `${pack.cases.length ? (packDone / pack.cases.length) * 100 : 0}%` }} /></div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="section-block coverage-block">
        <div className="section-heading"><div><p className="eyebrow">ARCHITECTURE COVERAGE</p><h2>架構書前台頁面／功能 × UAT 對照</h2></div><p>用這張表確認架構書列出的前台功能是否都有對應測試案例；若右欄為「待補」，代表尚未納入 UAT。</p></div>
        <div className="coverage-table-wrap"><table className="coverage-table"><thead><tr><th>架構書前台頁面／功能</th><th>對應 UAT 案例</th><th>涵蓋狀態</th></tr></thead><tbody>{coverageRows.map(([feature, cases]) => <tr key={feature}><td>{feature}</td><td>{cases}</td><td><span className="coverage-ok">✓ 已涵蓋</span></td></tr>)}</tbody></table></div>
        <div className="site-tree" aria-label="網站架構樹狀圖"><div className="tree-root">Deding 官網</div><ul>
          <li><span>公開區</span><ul><li>首頁 <code>A-01、A-10、D-11</code></li><li>新聞／競賽／地點 <code>A-10、D-11、E-11</code></li><li>Q&A／客服 <code>B-11、D-08、E-08</code></li><li>書店／商品 <code>B-10</code></li></ul></li>
          <li><span>報名與交易</span><ul><li>報名表／考生資料 <code>A-01～A-09、B-01～B-09、C-01～C-07</code></li><li>購物車／結帳／付款 <code>A-04、A-05、B-08、B-09、F-02～F-06</code></li></ul></li>
          <li><span>會員與考生</span><ul><li>會員中心／准考證 <code>A-06、A-11、D-09</code></li><li>成績查詢 <code>C-08、D-09、E-09、F-09</code></li></ul></li>
          <li><span>線上練習／測驗</span><ul><li>練習入口 <code>C-09、F-09</code></li><li>開始、作答、送出 <code>C-10、D-10</code></li><li>紀錄／分析 <code>C-11</code></li><li>中斷、點數、權限 <code>E-10、F-10、F-11</code></li></ul></li>
        </ul></div>
      </section>

      <section className="briefing-grid">
        <article className="briefing-card dark">
          <p className="eyebrow">EXECUTION RULE</p>
          <h2>不是打勾比賽。</h2>
          <p>Fail 必須附重現步驟與證據；Blocked 不能當 Pass。每人至少提出一項 Quick Win、一項下版改善與一項風險。</p>
        </article>
        <article className="briefing-card payment">
          <p className="eyebrow">ECPAY SANDBOX</p>
          <h3>測試卡 4311 · 9522 · 2222 · 2222</h3>
          <p>CVV 222｜有效月年需大於當月｜3D 測試碼 1234</p>
          <small>若無法確認為綠界測試環境，立即停止並標記 Blocked。</small>
        </article>
      </section>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{String(value).padStart(2, "0")}</strong></article>;
}

function StaffWorkspace({ pack, workspace, section, setSection, filter, setFilter, query, setQuery, setCaseRecord, setIdeaRecord, setScore }: {
  pack: StaffPack;
  workspace: WorkspaceState;
  section: "cases" | "ideas" | "guide";
  setSection: (value: "cases" | "ideas" | "guide") => void;
  filter: "all" | CaseStatus;
  setFilter: (value: "all" | CaseStatus) => void;
  query: string;
  setQuery: (value: string) => void;
  setCaseRecord: (id: string, patch: Partial<CaseRecord>) => void;
  setIdeaRecord: (id: string, patch: Partial<IdeaRecord>) => void;
  setScore: (staffId: string, dimension: string, value: number) => void;
}) {
  const completed = pack.cases.filter((item) => workspace.cases[item.id]?.done).length;
  const filteredCases = pack.cases.filter((item) => {
    const record = workspace.cases[item.id] ?? defaultCaseRecord();
    const matchesFilter = filter === "all" || record.status === filter;
    const haystack = `${item.id} ${item.title} ${item.steps.join(" ")} ${item.expected.join(" ")}`.toLowerCase();
    return matchesFilter && haystack.includes(query.toLowerCase());
  });

  return (
    <>
      <section className="staff-header" style={{ "--staff-color": staffColors[pack.id] } as React.CSSProperties}>
        <div className="staff-header-top">
          <span className="staff-letter large-letter">{pack.id}</span>
          <div><p className="eyebrow">TASK FORCE {pack.id}</p><h1>{pack.force}</h1></div>
          <div className="staff-completion"><strong>{completed}/{pack.cases.length}</strong><span>案例完成</span></div>
        </div>
        <div className="staff-brief"><p><b>環境</b>{pack.environment}</p><p><b>執行原則</b>{pack.precondition}</p></div>
        <nav className="workspace-tabs" aria-label="工作區分頁">
          <button className={section === "cases" ? "active" : ""} onClick={() => setSection("cases")}>測試案例 <span>{pack.cases.length}</span></button>
          <button className={section === "ideas" ? "active" : ""} onClick={() => setSection("ideas")}>改善提案 <span>3</span></button>
          <button className={section === "guide" ? "active" : ""} onClick={() => setSection("guide")}>執行說明</button>
        </nav>
      </section>

      {section === "cases" && (
        <section className="case-workspace">
          <div className="case-toolbar">
            <div className="filter-pills">
              {(["all", "pending", "pass", "fail", "blocked"] as const).map((value) => (
                <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                  {value === "all" ? "全部" : value === "pending" ? "未判定" : value === "pass" ? "通過" : value === "fail" ? "失敗" : "阻塞"}
                </button>
              ))}
            </div>
            <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋案例或操作內容" /></label>
          </div>
          <div className="case-list">
            {filteredCases.map((item) => (
              <CaseCard key={item.id} item={item} record={workspace.cases[item.id] ?? defaultCaseRecord()} onChange={(patch) => setCaseRecord(item.id, patch)} />
            ))}
            {!filteredCases.length && <div className="empty-state">這個篩選條件下沒有案例。</div>}
          </div>
        </section>
      )}

      {section === "ideas" && (
        <IdeasWorkspace pack={pack} workspace={workspace} setIdeaRecord={setIdeaRecord} setScore={setScore} />
      )}

      {section === "guide" && <ExecutionGuide />}
    </>
  );
}

function CaseCard({ item, record, onChange }: { item: UatCase; record: CaseRecord; onChange: (patch: Partial<CaseRecord>) => void }) {
  return (
    <article className={`case-card status-${record.status} ${record.done ? "is-done" : ""}`}>
      <div className="case-card-head">
        <label className="completion-check"><input type="checkbox" checked={record.done} onChange={(event) => onChange({ done: event.target.checked })} /><span /></label>
        <div><p className="case-id">{item.id}</p><h2>{item.title}</h2></div>
        <div className="status-buttons" aria-label={`${item.id} 測試結果`}>
          <span className="status-choice-hint">【結果請三選一】</span>
          {(["pass", "fail", "blocked"] as const).map((status) => (
            <button key={status} className={`status-${status} ${record.status === status ? "active" : ""}`} onClick={() => onChange({ status: record.status === status ? "pending" : status, done: true })}>
              {status === "pass" ? "通過" : status === "fail" ? "失敗" : "阻塞"}
            </button>
          ))}
        </div>
      </div>
      <div className="case-goal"><strong>【操作目標】</strong><span>{item.goal}</span></div>
      <div className="case-columns">
        <div className="case-instructions"><h3>【操作步驟】</h3><p className="instruction-note"><strong>【執行提醒】</strong><span>請依序完成下列步驟；若中途出現異常，先保留畫面與操作時間，再繼續或標記「阻塞」。</span></p><ol className="step-list">{item.steps.map((step, index) => <li key={index}><span className="step-number">{index + 1}</span><span>{step}</span></li>)}</ol></div>
        <div className="case-expected"><h3>【預期結果】</h3><ul className="expected-list">{item.expected.map((result, index) => <li key={index}><span className="expected-bullet">✓</span><span>{result}</span></li>)}</ul></div>
      </div>
      <div className="feedback-grid">
        <label><span>【問題發生步驟】</span><small className="field-help">請指出問題在哪一步出現，工程師可直接從該步驟重現。</small><select value={record.failureStep ?? ""} onChange={(event) => onChange({ failureStep: event.target.value })}><option value="">請選擇</option>{item.steps.map((step, index) => <option key={index} value={`第 ${index + 1} 步`}>第 {index + 1} 步：{step}</option>)}<option value="無法開始">無法開始操作</option><option value="多個步驟">多個步驟／流程交界</option><option value="完成後">完成後才發現</option></select></label>
        <label className="feedback-main"><span>【回報結果／實際畫面】</span><textarea value={record.feedback} onChange={(event) => onChange({ feedback: event.target.value })} placeholder="請說明：實際看到什麼？與預期哪裡不同？如何重現？有沒有改善建議？" /></label>
        <label><span>【嚴重度】</span><small className="field-help">請選擇這個問題對報名、付款、資料正確性與使用者的影響程度。</small><select value={record.severity} onChange={(event) => onChange({ severity: event.target.value })}><option value="">請選擇</option><option value="嚴重（Critical）">嚴重（Critical）</option><option value="高（High）">高（High）</option><option value="中（Medium）">中（Medium）</option><option value="低（Low）">低（Low）</option></select></label>
        <label><span>【證據／訂單編號】</span><small className="field-help">請填工程師能用來重現問題的線索：截圖／錄影檔名或連結、訂單編號、付款交易編號、發生時間、瀏覽器與手機型號。沒有訂單請填「未建立訂單」。</small><input value={record.evidence} onChange={(event) => onChange({ evidence: event.target.value })} placeholder="例：A-A05-20260728.png；訂單 #12345；Chrome 1440×900" /></label>
        <label className="attachment-field"><span>【附加截圖／錄影】</span><small className="field-help">可選取本機截圖或錄影作為回報附件；重新選檔會保留既有附件。圖片／PDF 可在工程統籌總表預覽與下載。</small><input type="file" multiple accept="image/*,video/*,.pdf" onChange={async (event) => { const picked = await Promise.all(Array.from(event.target.files ?? []).map(async (file) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, dataUrl: await readAttachment(file) }))); onChange({ attachments: [...(record.attachments ?? []), ...picked] }); event.currentTarget.value = ""; }} />{(record.attachments ?? []).length > 0 && <span className="attachment-list">{record.attachments.map((file, index) => <span className="attachment-chip" key={`${file.name}-${file.lastModified}-${index}`}><b>{file.name}</b><button type="button" aria-label={`刪除附件 ${file.name}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange({ attachments: record.attachments.filter((_, fileIndex) => fileIndex !== index) }); }}>刪除</button></span>)}</span>}</label>
      </div>
    </article>
  );
}

function IdeasWorkspace({ pack, workspace, setIdeaRecord, setScore }: {
  pack: StaffPack;
  workspace: WorkspaceState;
  setIdeaRecord: (id: string, patch: Partial<IdeaRecord>) => void;
  setScore: (staffId: string, dimension: string, value: number) => void;
}) {
  return (
    <section className="ideas-workspace">
      <div className="ideas-intro"><p className="eyebrow">CO-DESIGN REVIEW</p><h2>{pack.ideaTheme}</h2><p>請用具體情境與證據說明，不只寫「建議優化」。至少交付一項 Quick Win、一項下版改善與一項風險。</p></div>
      <div className="scorecard">
        <div className="scorecard-title"><h3>使用體驗評分</h3><span>1 分很差 · 5 分很好</span></div>
        {scoreDimensions.map((dimension) => (
          <div className="score-row" key={dimension}>
            <span>{dimension}</span>
            <div>{[1, 2, 3, 4, 5].map((value) => <button key={value} className={workspace.scores[pack.id]?.[dimension] === value ? "active" : ""} onClick={() => setScore(pack.id, dimension, value)}>{value}</button>)}</div>
          </div>
        ))}
      </div>
      <div className="idea-list">
        {pack.ideas.map((idea) => {
          const record = workspace.ideas[idea.id] ?? defaultIdeaRecord();
          return (
            <article className="idea-card" key={idea.id}>
              <p className="case-id">{idea.id}</p><h3>{idea.title}</h3><p>{idea.prompt}</p>
              <textarea value={record.response} onChange={(event) => setIdeaRecord(idea.id, { response: event.target.value })} placeholder="目前問題 → 證據 → 建議做法 → 預期效益 → 驗收方式" />
              <div className="idea-meta">
                <label><span>優先級</span><select value={record.priority} onChange={(event) => setIdeaRecord(idea.id, { priority: event.target.value })}><option value="">未決定</option><option>P0 上線前</option><option>P1 上線後首批</option><option>P2 後續優化</option></select></label>
                <label><span>實作難度初估</span><select value={record.effort} onChange={(event) => setIdeaRecord(idea.id, { effort: event.target.value })}><option value="">未決定</option><option>S</option><option>M</option><option>L</option><option>需技術評估</option></select></label>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EngineerWorkspace({ packs, workspace, setEngineeringRecord }: {
  packs: StaffPack[];
  workspace: WorkspaceState;
  setEngineeringRecord: (id: string, patch: Partial<EngineeringRecord>) => void;
}) {
  const [view, setView] = useState<"matrix" | "issues" | "ideas">("matrix");
  const [statusFilter, setStatusFilter] = useState<"all" | EngineeringRecord["status"]>("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [matrixResultFilter, setMatrixResultFilter] = useState<CaseStatus | "all">("all");
  const [matrixEngineeringFilter, setMatrixEngineeringFilter] = useState<EngineeringRecord["status"] | "all">("all");

  const allCases = packs.flatMap((pack) => pack.cases.map((item) => ({ pack, item, record: workspace.cases[item.id] ?? defaultCaseRecord(), engineering: workspace.engineering?.[`case:${item.id}`] ?? defaultEngineeringRecord() })));

  const issues = packs.flatMap((pack) => pack.cases.map((item) => ({ pack, item, record: workspace.cases[item.id] ?? defaultCaseRecord() })))
    .filter(({ record }) => record.status === "fail" || record.status === "blocked" || Boolean(record.feedback.trim()) || Boolean(record.severity));
  const proposals = packs.flatMap((pack) => pack.ideas.map((idea) => ({ pack, idea, record: workspace.ideas[idea.id] ?? defaultIdeaRecord() })))
    .filter(({ record }) => Boolean(record.response.trim()));
  const trackedIds = [...issues.map(({ item }) => `case:${item.id}`), ...proposals.map(({ idea }) => `idea:${idea.id}`)];
  const engineeringRecords = trackedIds.map((id) => workspace.engineering?.[id] ?? defaultEngineeringRecord());
  const fixingCount = engineeringRecords.filter((record) => record.status === "fixing").length;
  const fixedCount = engineeringRecords.filter((record) => record.fixed && !record.retestPassed).length;
  const closedCount = engineeringRecords.filter((record) => record.status === "closed" || record.retestPassed).length;
  const unreviewedCount = engineeringRecords.filter((record) => record.status === "unreviewed").length;
  const statusOptions: Array<{ value: EngineeringRecord["status"]; label: string }> = [
    { value: "unreviewed", label: "待確認" },
    { value: "confirmed", label: "已確認" },
    { value: "fixing", label: "修改中" },
    { value: "fixed", label: "已修正" },
    { value: "retest", label: "待複測" },
    { value: "closed", label: "已關閉" },
  ];

  const visibleIssues = issues.filter(({ item }) => {
    const record = workspace.engineering?.[`case:${item.id}`] ?? defaultEngineeringRecord();
    return statusFilter === "all" || record.status === statusFilter;
  });
  const visibleProposals = proposals.filter(({ idea }) => {
    const record = workspace.engineering?.[`idea:${idea.id}`] ?? defaultEngineeringRecord();
    return statusFilter === "all" || record.status === statusFilter;
  });
  const visibleMatrix = allCases.filter(({ pack, record, engineering }) => (staffFilter === "all" || pack.id === staffFilter) && (statusFilter === "all" || engineering.status === statusFilter) && (matrixResultFilter === "all" || record.status === matrixResultFilter) && (matrixEngineeringFilter === "all" || engineering.status === matrixEngineeringFilter));

  return (
    <section className="engineer-workspace">
      <header className="engineer-hero">
        <div>
          <p className="eyebrow">ENGINEERING CONTROL ROOM</p>
          <h1>工程統籌與修正追蹤</h1>
          <p>所有員工回覆已在此工作台集中呈現。工程師可直接確認問題、記錄修改、附上 Commit／PR，並交回複測，不需要先匯入交付檔。</p>
        </div>
        <div className="engineer-totals"><strong>{issues.length + proposals.length}</strong><span>已收集回覆</span></div>
      </header>

      <div className="engineer-metrics">
        <Metric label="待確認" value={unreviewedCount} tone="warn" />
        <Metric label="修改中" value={fixingCount} tone="ink" />
        <Metric label="已修正待複測" value={fixedCount} tone="good" />
        <Metric label="已關閉" value={closedCount} tone="good" />
      </div>

      <div className="engineer-toolbar">
        <div className="workspace-tabs engineer-tabs">
          <button className={view === "matrix" ? "active" : ""} onClick={() => setView("matrix")}>【UAT 全部總表】<span>{allCases.length}</span></button>
          <button className={view === "issues" ? "active" : ""} onClick={() => setView("issues")}>問題回報 <span>{issues.length}</span></button>
          <button className={view === "ideas" ? "active" : ""} onClick={() => setView("ideas")}>改善提案 <span>{proposals.length}</span></button>
        </div>
        <div className="engineer-filters"><label className="engineer-filter"><span>工程狀態</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">全部</option>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="engineer-filter"><span>測試人員</span><select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)}><option value="all">全部員工</option>{packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label></div>
      </div>

      {view === "matrix" && <UatMatrix rows={visibleMatrix} resultFilter={matrixResultFilter} setResultFilter={setMatrixResultFilter} engineeringFilter={matrixEngineeringFilter} setEngineeringFilter={setMatrixEngineeringFilter} staffFilter={staffFilter} setStaffFilter={setStaffFilter} packs={packs} />}

      {view === "issues" && (
        <div className="engineering-list">
          {visibleIssues.map(({ pack, item, record }) => (
            <EngineeringCard
              key={item.id}
              trackingId={`case:${item.id}`}
              label={`${pack.name} · ${item.id}`}
              title={item.title}
              reportStatus={record.status}
              severity={record.severity}
              feedback={record.feedback}
              evidence={record.evidence}
              attachments={record.attachments}
              engineering={workspace.engineering?.[`case:${item.id}`] ?? defaultEngineeringRecord()}
              statusOptions={statusOptions}
              onChange={(patch) => setEngineeringRecord(`case:${item.id}`, patch)}
            />
          ))}
          {!visibleIssues.length && <EngineerEmpty type="問題回報" />}
        </div>
      )}

      {view === "ideas" && (
        <div className="engineering-list">
          {visibleProposals.map(({ pack, idea, record }) => (
            <EngineeringCard
              key={idea.id}
              trackingId={`idea:${idea.id}`}
              label={`${pack.name} · ${idea.id}`}
              title={idea.title}
              reportStatus="proposal"
              severity={record.priority}
              feedback={record.response}
              evidence={`實作難度初估：${record.effort || "未填"}`}
              attachments={[]}
              engineering={workspace.engineering?.[`idea:${idea.id}`] ?? defaultEngineeringRecord()}
              statusOptions={statusOptions}
              onChange={(patch) => setEngineeringRecord(`idea:${idea.id}`, patch)}
            />
          ))}
          {!visibleProposals.length && <EngineerEmpty type="改善提案" />}
        </div>
      )}
    </section>
  );
}

function UatMatrix({ rows, resultFilter, setResultFilter, engineeringFilter, setEngineeringFilter, staffFilter, setStaffFilter, packs }: { rows: Array<{ pack: StaffPack; item: UatCase; record: CaseRecord; engineering: EngineeringRecord }>; resultFilter: CaseStatus | "all"; setResultFilter: (value: CaseStatus | "all") => void; engineeringFilter: EngineeringRecord["status"] | "all"; setEngineeringFilter: (value: EngineeringRecord["status"] | "all") => void; staffFilter: string; setStaffFilter: (value: string) => void; packs: StaffPack[] }) {
  return (
    <div className="uat-matrix-wrap">
      <div className="uat-matrix-intro"><strong>【完整性檢查】</strong><span>這裡列出目前全部 UAT 案例。若某題尚未執行，測試結果會顯示「未判定」；若員工有回報問題，請再到「問題回報」處理工程狀態。</span></div>
      <div className="uat-matrix-scroll"><table className="uat-matrix"><caption>UAT 測試案例總表，共 {rows.length} 筆目前符合篩選條件</caption><thead><tr><th><label className="matrix-filter-label">員工／Task Force<select value={staffFilter} onChange={(e)=>setStaffFilter(e.target.value)}><option value="all">全部員工</option>{packs.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></th><th>案例</th><th>操作目標</th><th><label className="matrix-filter-label">測試結果<select value={resultFilter} onChange={(e)=>setResultFilter(e.target.value as CaseStatus | "all")}><option value="all">全部結果</option><option value="pending">未判定</option><option value="pass">通過</option><option value="fail">失敗</option><option value="blocked">阻塞</option></select></label></th><th>回報結果／實際畫面</th><th>嚴重度</th><th>證據／訂單編號</th><th>附加檔案</th><th><label className="matrix-filter-label">工程處理<select value={engineeringFilter} onChange={(e)=>setEngineeringFilter(e.target.value as EngineeringRecord["status"] | "all")}><option value="all">全部狀態</option><option value="unreviewed">待確認</option><option value="confirmed">已確認</option><option value="fixing">修改中</option><option value="fixed">已修正待複測</option><option value="retest">複測中</option><option value="closed">已關閉</option></select></label></th></tr></thead><tbody>{rows.map(({ pack, item, record, engineering }) => <tr key={item.id}><td><strong>{pack.name}</strong><small>{pack.force}</small></td><td><b className="matrix-id">{item.id}</b><span>{item.title}</span></td><td>{item.goal}</td><td><b className={`matrix-status matrix-${record.status}`}>{caseStatusLabels[record.status]}</b>{record.done && <small>已勾選完成</small>}</td><td className="matrix-feedback">{record.feedback || "尚未填寫"}</td><td>{record.severity ? severityLabels[record.severity] ?? record.severity : "未填寫"}</td><td>{record.evidence || "尚未填寫"}</td><td>{(record.attachments ?? []).length > 0 ? <div className="matrix-attachments">{record.attachments.map((file, index) => <span key={`${file.name}-${index}`}><b>{file.name}</b>{file.dataUrl && file.type.startsWith("image/") && <a href={file.dataUrl} target="_blank" rel="noreferrer">預覽</a>}{file.dataUrl && <a href={file.dataUrl} download={file.name}>下載</a>}</span>)}</div> : "未附檔"}</td><td><b className={`matrix-engineering eng-text-${engineering.status}`}>{engineeringStatusLabel(engineering.status)}</b>{engineering.retestPassed && <small>複測通過</small>}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function engineeringStatusLabel(status: EngineeringRecord["status"]) {
  return { unreviewed: "待確認", confirmed: "已確認", fixing: "修改中", fixed: "已修正", retest: "待複測", closed: "已關閉" }[status];
}

function EngineeringCard({ trackingId, label, title, reportStatus, severity, feedback, evidence, attachments, engineering, statusOptions, onChange }: {
  trackingId: string;
  label: string;
  title: string;
  reportStatus: string;
  severity: string;
  feedback: string;
  evidence: string;
  attachments?: AttachmentRecord[];
  engineering: EngineeringRecord;
  statusOptions: Array<{ value: EngineeringRecord["status"]; label: string }>;
  onChange: (patch: Partial<EngineeringRecord>) => void;
}) {
  return (
    <article className={`engineering-card eng-${engineering.status}`} data-tracking-id={trackingId}>
      <div className="engineering-report">
        <div className="engineering-labels"><span>{label}</span><b className={`report-${reportStatus}`}>{reportStatus === "proposal" ? "提案" : caseStatusLabels[reportStatus as CaseStatus] ?? reportStatus}</b>{severity && <b>{severityLabels[severity] ?? severity}</b>}</div>
        <h2>{title}</h2>
        <div className="employee-feedback"><span>員工回覆</span><p>{feedback || "未填寫文字說明，請參考狀態與證據。"}</p></div>
        {evidence && <p className="evidence-line"><b>證據／補充：</b>{evidence}</p>}
        {(attachments ?? []).length > 0 && <div className="engineering-attachments"><strong>員工附檔</strong>{attachments?.map((file) => <span key={`${file.name}-${file.lastModified}`}><b>{file.name}</b>{file.dataUrl && file.type.startsWith("image/") && <a href={file.dataUrl} target="_blank" rel="noreferrer">預覽</a>}{file.dataUrl && <a href={file.dataUrl} download={file.name}>下載</a>}</span>)}</div>}
      </div>
      <div className="engineering-action">
        <div className="engineering-fields">
          <label><span>工程狀態</span><select value={engineering.status} onChange={(event) => onChange({ status: event.target.value as EngineeringRecord["status"] })}>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>負責人</span><input value={engineering.owner} onChange={(event) => onChange({ owner: event.target.value })} placeholder="工程師姓名" /></label>
          <label><span>Commit／PR／版本</span><input value={engineering.reference} onChange={(event) => onChange({ reference: event.target.value })} placeholder="連結、編號或版本" /></label>
        </div>
        <label className="engineering-note"><span>工程確認與修改紀錄</span><textarea value={engineering.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="根因、修改內容、影響範圍、部署日期與複測注意事項…" /></label>
        <div className="engineering-checks">
          <label><input type="checkbox" checked={engineering.fixed} onChange={(event) => onChange({ fixed: event.target.checked, status: event.target.checked ? "retest" : engineering.status })} /><span>工程師已完成修正</span></label>
          <label><input type="checkbox" checked={engineering.retestPassed} onChange={(event) => onChange({ retestPassed: event.target.checked, status: event.target.checked ? "closed" : "retest" })} /><span>QA 複測通過並關閉</span></label>
        </div>
      </div>
    </article>
  );
}

function EngineerEmpty({ type }: { type: string }) {
  return (
    <div className="engineer-empty">
      <span>⇩</span><h3>尚無{type}</h3><p>目前沒有符合條件的資料；請調整上方工程狀態／測試人員篩選。工程師可直接在此頁修改回報。</p>
    </div>
  );
}

function ExecutionGuide() {
  return (
    <section className="guide-grid">
      <article><span className="guide-number">01</span><h3>只用虛構資料</h3><p>不得輸入真實家長、學生、手機、Email 或身分證。每人使用自己的測試帳號與資料編號。</p></article>
      <article><span className="guide-number">02</span><h3>Fail 要能重現</h3><p>記錄環境、角色、完整步驟、實際與預期結果、發生時間、截圖及訂單編號。</p></article>
      <article><span className="guide-number">03</span><h3>Blocked 不是 Pass</h3><p>環境、帳號、付款或資料不足時標記 Blocked，並清楚寫下解除阻塞所需條件。</p></article>
      <article><span className="guide-number">04</span><h3>測試金流先辨識環境</h3><p>只在 ECPay 測試環境使用 4311-9522-2222-2222／CVV 222／3D 1234。無法辨識環境就停止。</p></article>
      <article><span className="guide-number">05</span><h3>直接處理與複測</h3><p>工程師直接在「問題回報」編輯狀態、負責人、修正紀錄與 Commit／PR；修改後勾選「QA 複測通過」即可關閉。匯出備份為選用功能。</p></article>
      <article><span className="guide-number">06</span><h3>提出可採用的建議</h3><p>一個問題一張提案，說明受影響角色、預期效益、優先級、難度及如何驗收改善。</p></article>
    </section>
  );
}
