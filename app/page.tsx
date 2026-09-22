"use client";

import { useState } from "react";

import type { Company, StatementRow, StatementResponse, FinanceDetailRow, FinanceAnalysisResponse, EvidenceCell, StatementEvidenceResponse, FinanceEvidenceResponse, ReviewCategory, ReviewDecision, ReviewDecisionMap, StatementEvidenceCache } from "@/lib/types";
import { buildStorageKey, getStatementRowKey, getFinanceRowKey, decisionStatus, parseDecisions, serializeDecisions, statuses } from "@/lib/review";

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function formatStatementValue(
  row: StatementRow,
  value: number | null
) {
  if (value === null) {
    return "-";
  }

  if (row.value_type === "per_share") {
    return value.toLocaleString("ko-KR", {
      maximumFractionDigits: 2,
    });
  }

  return (value / 1_000_000).toLocaleString(
    "ko-KR",
    {
      maximumFractionDigits: 1,
    }
  );
}

function formatExcludedValue(
  value: number | null
) {
  if (value === null) {
    return "-";
  }

  return (value / 1_000_000).toLocaleString(
    "ko-KR",
    {
      maximumFractionDigits: 1,
    }
  );
}

function formatDetailAmount(
  value: number | null
) {
  if (value === null) {
    return "-";
  }

  return value.toLocaleString("ko-KR");
}

function readStoredDecisions(storageKey: string): ReviewDecisionMap {
  try { return parseDecisions(window.localStorage.getItem(storageKey)); } catch { return {}; }
}
function writeStoredDecisions(storageKey: string, decisions: ReviewDecisionMap) {
  window.localStorage.setItem(storageKey, serializeDecisions(decisions));
}
function getFinanceSection(
  account: string
): "금융수익" | "금융비용" | null {
  const normalized =
    normalizeText(account);

  if (
    normalized.includes("금융수익") ||
    normalized.includes("금융이익")
  ) {
    return "금융수익";
  }

  if (
    normalized.includes("금융비용") ||
    normalized.includes("금융원가")
  ) {
    return "금융비용";
  }

  return null;
}

function getEvidenceTypeLabel(
  value: string
) {
  if (value === "reconciled_table") return "구조적 합산 대사 일치";
  if (
    value ===
    "direct_amount_table"
  ) {
    return "계정·금액 직접 일치";
  }

  if (
    value === "direct_table"
  ) {
    return "계정 직접 일치";
  }

  if (
    value === "title_match"
  ) {
    return "주석 제목 일치";
  }

  return "관련 내용 탐색";
}

/*
  statement evidence와 finance evidence에서
  같이 사용할 수 있는 표 렌더러
*/
function EvidenceTableView({
  table,
  account,
}: {
  table: {
    unit: string | null;

    amount_match?: boolean;

    classification_structure?: boolean;

    focused_rows: EvidenceCell[][];

    rows: EvidenceCell[][];
  };

  account: string;
}) {
  const rows =
    table.focused_rows?.length > 0
      ? table.focused_rows
      : table.rows.slice(0, 15);

  const normalizedAccount =
    normalizeText(account);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {table.unit && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
            단위: {table.unit}
          </span>
        )}

        {table.amount_match && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            재무제표 금액 일치
          </span>
        )}

        {table.classification_structure && (
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
            발생원천 분해 가능
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map(
              (row, rowIndex) => {
                const matched =
                  row.some((cell) =>
                    normalizeText(
                      cell.text
                    ).includes(
                      normalizedAccount
                    )
                  );

                return (
                  <tr
                    key={rowIndex}
                    className={
                      matched
                        ? "bg-blue-50"
                        : "bg-white"
                    }
                  >
                    {row.map(
                      (
                        cell,
                        cellIndex
                      ) => {
                        const className =
                          "min-w-[120px] border-b border-r px-3 py-3 align-middle last:border-r-0";

                        if (
                          cell.header
                        ) {
                          return (
                            <th
                              key={
                                cellIndex
                              }
                              rowSpan={
                                cell.row_span
                              }
                              colSpan={
                                cell.col_span
                              }
                              className={`${className} bg-gray-50 text-center font-semibold text-gray-700`}
                            >
                              {cell.text ||
                                " "}
                            </th>
                          );
                        }

                        return (
                          <td
                            key={
                              cellIndex
                            }
                            rowSpan={
                              cell.row_span
                            }
                            colSpan={
                              cell.col_span
                            }
                            className={`${className} ${
                              cellIndex ===
                              0
                                ? "font-medium text-gray-800"
                                : "text-right text-gray-700"
                            }`}
                          >
                            {cell.text ||
                              " "}
                          </td>
                        );
                      }
                    )}
                  </tr>
                );
              }
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Home() {
  const [
    searchText,
    setSearchText,
  ] = useState("");

  const [
    searchResults,
    setSearchResults,
  ] = useState<Company[]>([]);

  const [
    selectedCompany,
    setSelectedCompany,
  ] =
    useState<Company | null>(
      null
    );

  const [year, setYear] =
    useState("2025");

  const [fsDiv, setFsDiv] =
    useState("CFS");

  const [
    searching,
    setSearching,
  ] = useState(false);

  const [
    analyzing,
    setAnalyzing,
  ] = useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const [
    statement,
    setStatement,
  ] =
    useState<StatementResponse | null>(
      null
    );

  const [
    selectedStatementRow,
    setSelectedStatementRow,
  ] =
    useState<StatementRow | null>(
      null
    );

  /*
    범용 Statement Evidence
  */

  const [
    statementEvidence,
    setStatementEvidence,
  ] =
    useState<StatementEvidenceResponse | null>(
      null
    );

  const [
    statementEvidenceLoading,
    setStatementEvidenceLoading,
  ] = useState(false);

  const [
    statementEvidenceError,
    setStatementEvidenceError,
  ] =
    useState<string | null>(
      null
    );

  const [
    statementEvidenceCache,
    setStatementEvidenceCache,
  ] =
    useState<StatementEvidenceCache>(
      {}
    );

  /*
    금융 상세 분석
  */

  const [
    financeAnalysis,
    setFinanceAnalysis,
  ] =
    useState<FinanceAnalysisResponse | null>(
      null
    );

  const [
    financeLoading,
    setFinanceLoading,
  ] = useState(false);

  const [
    selectedFinanceRow,
    setSelectedFinanceRow,
  ] =
    useState<FinanceDetailRow | null>(
      null
    );

  /*
    금융 세부계정 Evidence
  */

  const [
    financeEvidence,
    setFinanceEvidence,
  ] =
    useState<FinanceEvidenceResponse | null>(
      null
    );

  const [
    financeEvidenceLoading,
    setFinanceEvidenceLoading,
  ] = useState(false);

  const [
    financeEvidenceError,
    setFinanceEvidenceError,
  ] =
    useState<string | null>(
      null
    );

  const [
    reviewDecisions,
    setReviewDecisions,
  ] =
    useState<ReviewDecisionMap>(
      {}
    );

  const [
    saveStatus,
    setSaveStatus,
  ] =
    useState<string | null>(
      null
    );

  const [
    showExcluded,
    setShowExcluded,
  ] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [originalOrder, setOriginalOrder] = useState(false);
  const [financeEvidenceCache, setFinanceEvidenceCache] = useState<Record<string, FinanceEvidenceResponse>>({});
  function getStorageKey() {
    return statement ? buildStorageKey(statement.corp_code, statement.year, statement.fs_div, statement.report.rcept_no) : null;
  }
  function persistDecisions(
    next: ReviewDecisionMap
  ) {
    setReviewDecisions(next);

    const storageKey =
      getStorageKey();

    if (!storageKey) {
      return;
    }

    try { writeStoredDecisions(storageKey, next); } catch { setSaveStatus("저장 실패: 브라우저 저장 공간을 확인하세요. 현재 검토내용은 XLSX로 보관할 수 있습니다."); return; }

    const time =
      new Date().toLocaleTimeString(
        "ko-KR",
        {
          hour: "2-digit",
          minute: "2-digit",
        }
      );

    setSaveStatus(
      `자동 저장됨 ${time}`
    );
  }

  function getStatementDecision(
    row: StatementRow
  ) {
    return (
      reviewDecisions[
        getStatementRowKey(row)
      ] ?? {
        classification: null,
        memo: "",
      }
    );
  }

  function setStatementClassification(
    row: StatementRow,
    classification: ReviewCategory | null
  ) {
    if (getFinanceSection(row.account) || row.ifrs18_status !== "검토 필요") return;
    const key = getStatementRowKey(row);

    const current =
      reviewDecisions[key] ?? {
        classification: null,
        memo: "",
      };

    persistDecisions({
      ...reviewDecisions,

      [key]: {
        ...current,
        classification,
        review_status: "검토중",
      },
    });
  }

  function setStatementMemo(
    row: StatementRow,
    memo: string
  ) {
    const key =
      getStatementRowKey(row);

    const current =
      reviewDecisions[key] ?? {
        classification: null,
        memo: "",
      };

    persistDecisions({
      ...reviewDecisions,

      [key]: {
        ...current,
        memo,
      },
    });
  }

  function getFinanceDecision(
    row: FinanceDetailRow
  ) {
    return (
      reviewDecisions[
        getFinanceRowKey(row)
      ] ?? {
        classification: null,
        memo: "",
      }
    );
  }

  function setFinanceClassification(
    row: FinanceDetailRow,
    classification: ReviewCategory | null
  ) {
    if (row.ifrs18_status === "합계") return;
    const key = getFinanceRowKey(row);

    const current =
      reviewDecisions[key] ?? {
        classification: null,
        memo: "",
      };

    persistDecisions({
      ...reviewDecisions,

      [key]: {
        ...current,
        classification,
        review_status: "검토중",
      },
    });
  }

  function setFinanceMemo(
    row: FinanceDetailRow,
    memo: string
  ) {
    const key =
      getFinanceRowKey(row);

    const current =
      reviewDecisions[key] ?? {
        classification: null,
        memo: "",
      };

    persistDecisions({
      ...reviewDecisions,

      [key]: {
        ...current,
        memo,
      },
    });
  }

  async function searchCompany() {
    if (analyzing || statementEvidenceLoading || financeEvidenceLoading || financeLoading) return;
    if (!searchText.trim()) {
      return;
    }

    try {
      setSearching(true);

      setError(null);

      setSearchResults([]);

      const response =
        await fetch(
          `/api/company-search?q=${encodeURIComponent(
            searchText.trim()
          )}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "회사 검색에 실패했습니다."
        );
      }

      setSearchResults(
        data.results ?? []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "회사 검색 중 오류가 발생했습니다."
      );
    } finally {
      setSearching(false);
    }
  }

  function selectCompany(
    company: Company
  ) {
    if (analyzing || statementEvidenceLoading || financeEvidenceLoading || financeLoading) return;
    setSelectedCompany(
      company
    );

    setSearchText(
      company.corp_name
    );

    setSearchResults([]);

    resetAnalysis();
  }

  function resetAnalysis() {
    setStatement(null);

    setSelectedStatementRow(
      null
    );

    setStatementEvidence(null);

    setStatementEvidenceError(
      null
    );

    setStatementEvidenceCache(
      {}
    );

    setFinanceAnalysis(null);

    setSelectedFinanceRow(
      null
    );

    setFinanceEvidence(null);

    setFinanceEvidenceError(
      null
    );

    setShowExcluded(false);

    setReviewDecisions({});

    setSaveStatus(null);
  }

  async function runStatementAnalysis() {
    if (!selectedCompany) {
      setError(
        "먼저 분석할 회사를 선택해주세요."
      );

      return;
    }

    if (analyzing || statementEvidenceLoading || financeEvidenceLoading || financeLoading) return;
    try {
      setFinanceEvidenceCache({});
      setReviewDecisions({});
      setAnalyzing(true);

      setError(null);

      setSelectedStatementRow(
        null
      );

      setStatementEvidence(null);

      setStatementEvidenceCache(
        {}
      );

      setFinanceAnalysis(null);

      setSelectedFinanceRow(
        null
      );

      setFinanceEvidence(null);

      const params =
        new URLSearchParams({
          corp_code:
            selectedCompany.corp_code,

          corp_name:
            selectedCompany.corp_name,

          year,

          fs_div: fsDiv,
        });

      const response =
        await fetch(
          `/api/ifrs18-statement?${params.toString()}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "손익계산서 분석에 실패했습니다."
        );
      }

      setStatement(data);
      const financeParams = new URLSearchParams({corp_code: data.corp_code, corp_name: data.company, year: data.year, fs_div: data.fs_div, rcept_no: data.report.rcept_no});
      try {
        const res = await fetch(`/api/ifrs18-analysis?${financeParams}`);
        const finance = await res.json();
        if (res.ok) setFinanceAnalysis(finance);
        else setError(finance.error ?? "금융 상세를 불러오지 못했습니다. 금융 계정을 선택하여 다시 조회하세요.");
      } catch { setError("금융 상세를 불러오지 못했습니다. 금융 계정을 선택하여 다시 조회하세요."); }

      const storageKey =
        buildStorageKey(
          selectedCompany.corp_code,
          year,
          fsDiv,
          data.report.rcept_no
        );

      const saved =
        readStoredDecisions(
          storageKey
        );

      setReviewDecisions(
        saved
      );

      if (
        Object.keys(saved).length >
        0
      ) {
        setSaveStatus(
          "저장된 검토 결과를 불러왔습니다."
        );
      } else {
        try {
          const legacy = window.localStorage.getItem(["ifrs18-full-review-v2", data.corp_code, data.year, data.fs_div].join(":"));
          setSaveStatus(legacy ? "이전 버전 저장자료는 보존되어 있습니다. 접수번호가 없어 자동 적용하지 않습니다." : null);
        } catch { setSaveStatus("브라우저 저장소를 읽을 수 없습니다."); }
      }
    } catch (err) {
      setStatement(null);

      setError(
        err instanceof Error
          ? err.message
          : "분석 중 오류가 발생했습니다."
      );
    } finally {
      setAnalyzing(false);
    }
  }

  /*
    범용 손익계정 Evidence
  */
  async function loadStatementEvidence(
    row: StatementRow
  ) {
    if (!selectedCompany) {
      return;
    }

    const rowKey =
      getStatementRowKey(row);

    const cached =
      statementEvidenceCache[
        rowKey
      ];

    if (cached) {
      setStatementEvidence(
        cached
      );

      setStatementEvidenceError(
        null
      );

      setStatementEvidenceLoading(
        false
      );

      return;
    }

    try {
      setStatementEvidenceLoading(
        true
      );

      setStatementEvidence(null);

      setStatementEvidenceError(
        null
      );

      const params = new URLSearchParams({corp_code: statement!.corp_code, year: statement!.year, fs_div: statement!.fs_div, rcept_no: statement!.report.rcept_no, account: row.account});

      if (
        row.current_amount !==
        null
      ) {
        params.set(
          "current_amount",
          String(
            row.current_amount
          )
        );
      }

      const response =
        await fetch(
          `/api/ifrs18-statement-evidence?${params.toString()}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "관련 주석 탐색에 실패했습니다."
        );
      }

      setStatementEvidence(
        data
      );

      setStatementEvidenceCache(
        (previous) => ({
          ...previous,

          [rowKey]: data,
        })
      );
    } catch (err) {
      setStatementEvidenceError(
        err instanceof Error
          ? err.message
          : "관련 주석 탐색 중 오류가 발생했습니다."
      );
    } finally {
      setStatementEvidenceLoading(
        false
      );
    }
  }

  async function selectStatementRow(
    row: StatementRow
  ) {
    if (statementEvidenceLoading || financeEvidenceLoading || analyzing) return;
    if (
      row.ifrs18_status ===
      "요약"
    ) {
      return;
    }

    setSelectedStatementRow(
      row
    );

    setSelectedFinanceRow(
      null
    );

    setFinanceEvidence(null);

    setFinanceEvidenceError(
      null
    );

    const financeSection =
      getFinanceSection(
        row.account
      );

    const tasks: Promise<void>[] =
      [
        loadStatementEvidence(
          row
        ),
      ];

    if (financeSection) {
      tasks.push(
        loadFinanceDetails()
      );
    }

    await Promise.allSettled(
      tasks
    );

    setTimeout(() => {
      document
        .getElementById(
          "statement-review-panel"
        )
        ?.scrollIntoView({
          behavior: "smooth",

          block: "start",
        });
    }, 100);
  }

  async function loadFinanceDetails() {
    if (!selectedCompany) {
      return;
    }

    if (financeAnalysis) {
      return;
    }

    try {
      setFinanceLoading(
        true
      );

      const params = new URLSearchParams({corp_code: statement!.corp_code, year: statement!.year, fs_div: statement!.fs_div, rcept_no: statement!.report.rcept_no, corp_name: statement!.company});

      const response =
        await fetch(
          `/api/ifrs18-analysis?${params.toString()}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "금융수익·금융비용 세부 분석에 실패했습니다."
        );
      }

      setFinanceAnalysis(
        data
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "금융 세부 분석 중 오류가 발생했습니다."
      );
    } finally {
      setFinanceLoading(
        false
      );
    }
  }

  async function loadFinanceEvidence(
    row: FinanceDetailRow
  ) {
    if (
      !selectedCompany ||
      row.ifrs18_status ===
        "합계"
    ) {
      return;
    }

    if (financeEvidenceLoading || statementEvidenceLoading) return;
    try {
      setSelectedFinanceRow(
        row
      );

      setFinanceEvidence(null);

      setFinanceEvidenceError(
        null
      );

      setFinanceEvidenceLoading(
        true
      );

      const params = new URLSearchParams({corp_code: statement!.corp_code, year: statement!.year, fs_div: statement!.fs_div, rcept_no: statement!.report.rcept_no, account: row.account, category: row.category, unit: financeAnalysis?.finance_note.unit ?? ""});

      if (
        row.current_amount !==
        null
      ) {
        params.set(
          "current_amount",
          String(
            row.current_amount
          )
        );
      }

      const response =
        await fetch(
          `/api/ifrs18-evidence?${params.toString()}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "관련 주석 조회에 실패했습니다."
        );
      }

      setFinanceEvidence(data);
      setFinanceEvidenceCache(previous => ({...previous, [getFinanceRowKey(row)]: data}));

      setTimeout(() => {
        document
          .getElementById(
            "finance-evidence-panel"
          )
          ?.scrollIntoView({
            behavior: "smooth",

            block: "start",
          });
      }, 100);
    } catch (err) {
      setFinanceEvidenceError(
        err instanceof Error
          ? err.message
          : "근거 조회 중 오류가 발생했습니다."
      );
    } finally {
      setFinanceEvidenceLoading(
        false
      );
    }
  }

  function setDecisionStatus(key: string, status: ReviewDecision["review_status"]) {
    const current = reviewDecisions[key] ?? {classification:null,memo:""};
    if (status === "완료" && !current.classification) { setSaveStatus("완료로 변경하려면 IFRS 18 분류를 선택하세요."); return; }
    persistDecisions({...reviewDecisions, [key]: {...current, review_status: status}});
  }
  async function exportWorkbook() {
    if (!statement) return;
    setExporting(true); setError(null);
    try {
      const response = await fetch("/api/export-xlsx", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({statement, financeAnalysis, reviewDecisions, statementEvidenceCache, financeEvidenceCache})});
      if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? "내보내기에 실패했습니다."); }
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
      link.href=url; link.download = ["IFRS18",statement.company,statement.year,statement.fs_div,statement.rcept_no].join("_")+".xlsx";
      link.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : "Excel 내보내기에 실패했습니다."); }
    finally { setExporting(false); }
  }
  const reviewRows =
    statement?.statement_rows.filter(
      (row) =>
        row.ifrs18_status ===
        "검토 필요"
    ) ?? [];

  const decisionRows = reviewRows.filter(row => !getFinanceSection(row.account));
  const financeReviewRows = financeAnalysis?.financial_data.filter(row => row.ifrs18_status !== "합계" && ["금융수익", "금융비용"].includes(row.category)) ?? [];
  const completedCount = decisionRows.filter(row => decisionStatus(getStatementDecision(row)) === "완료").length + financeReviewRows.filter(row => decisionStatus(getFinanceDecision(row)) === "완료").length;
  const reviewCount = decisionRows.length + financeReviewRows.length;
  const statementEvidenceCount =
    reviewRows.filter((row) =>
      Boolean(
        statementEvidenceCache[
          getStatementRowKey(row)
        ]
      )
    ).length;

  const selectedFinanceSection =
    selectedStatementRow
      ? getFinanceSection(
          selectedStatementRow.account
        )
      : null;

  const visibleFinanceRows =
    financeAnalysis &&
    selectedFinanceSection
      ? financeAnalysis.financial_data.filter(
          (row) =>
            row.category ===
            selectedFinanceSection
        )
      : [];

  const excludedRows =
    statement
      ? [
          ...statement.excluded_oci_rows,
          ...statement.excluded_comprehensive_rows,
        ]
      : [];

  const primaryStatementEvidence =
    statementEvidence?.primary_evidence ??
    null;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl p-8">
        <header className="mb-8">
          <p className="mb-2 text-sm font-medium text-gray-500">
            IFRS 18 Data Review
          </p>

          <h1 className="text-3xl font-bold text-gray-900">
            IFRS 18 검토 지원
          </h1>

          <p className="mt-3 max-w-3xl text-gray-600">
            OpenDART 손익계산서
            전체 계정을 추출하고,
            관련 주석 근거와
            Reviewer 판단을
            연결합니다.
          </p>
        </header>

        {statement && <section className="mb-6 rounded-xl border bg-white p-5 text-sm"><div className="flex flex-wrap justify-between gap-3"><div><strong>{statement.company} · {statement.report.report_name}</strong><p className="mt-1">접수번호 <a className="text-blue-700 underline" href={"https://dart.fss.or.kr/dsaf001/main.do?rcpNo="+statement.report.rcept_no} target="_blank" rel="noreferrer">{statement.report.rcept_no}</a> · 접수일 {statement.report.rcept_date}</p><p>검토 완료 {completedCount} / {reviewCount} · 금융 상세 {financeAnalysis ? "조회됨" : "미조회"}</p></div><button disabled={exporting || analyzing} className="rounded bg-gray-900 px-4 py-2 font-semibold text-white disabled:opacity-40" onClick={exportWorkbook}>{exporting ? "생성 중…" : "XLSX 검토조서 내보내기"}</button></div><p className="mt-3 text-xs text-gray-500">근거 대사: {(["verified","reconciled","strong","review"] as const).map(c => c+" "+Object.values(statementEvidenceCache).filter(e=>e.primary_confidence===c).length).join(" · ")} · 미조회 근거는 Excel에도 미조회로 표시됩니다.</p><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={originalOrder} onChange={e=>setOriginalOrder(e.target.checked)}/>DART 원본순서로 표시</label>{saveStatus && <p role="status" className="mt-2">{saveStatus}</p>}</section>}
        <section className="mb-8 rounded-xl border bg-white p-6">
          <h2 className="mb-5 text-xl font-semibold">
            분석 조건
          </h2>

          <div className="grid gap-5 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <label className="mb-2 block text-sm font-medium">
                회사
              </label>

              <div className="flex gap-2">
                <input
                  disabled={analyzing || statementEvidenceLoading || financeEvidenceLoading || financeLoading}
                  value={searchText}
                  onChange={(
                    event
                  ) => {
                    setSearchText(
                      event.target.value
                    );

                    setSelectedCompany(
                      null
                    );

                    resetAnalysis();
                  }}
                  onKeyDown={(
                    event
                  ) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      searchCompany();
                    }
                  }}
                  placeholder="예: SK하이닉스"
                  className="min-w-0 flex-1 rounded-lg border px-3 py-2"
                />

                <button
                  onClick={
                    searchCompany
                  }
                  disabled={
                    searching
                  }
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {searching
                    ? "검색 중"
                    : "검색"}
                </button>
              </div>

              {searchResults.length >
                0 && (
                <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">
                  {searchResults.map(
                    (company) => (
                      <button
                        key={
                          company.corp_code
                        }
                        onClick={() =>
                          selectCompany(
                            company
                          )
                        }
                        className="flex w-full items-center justify-between border-b px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <div>
                          <p className="font-medium">
                            {
                              company.corp_name
                            }
                          </p>

                          <p className="mt-1 text-xs text-gray-500">
                            DART 고유번호{" "}
                            {
                              company.corp_code
                            }
                          </p>
                        </div>

                        <span className="text-sm text-gray-500">
                          {company.stock_code ||
                            "비상장"}
                        </span>
                      </button>
                    )
                  )}
                </div>
              )}

              {selectedCompany && (
                <p className="mt-2 text-sm text-green-700">
                  선택됨:{" "}
                  {
                    selectedCompany.corp_name
                  }{" "}
                  (
                  {
                    selectedCompany.stock_code
                  }
                  )
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                사업연도
              </label>

              <select
                disabled={analyzing || statementEvidenceLoading || financeEvidenceLoading || financeLoading}
                value={year}
                onChange={(
                  event
                ) => {
                  setYear(
                    event.target.value
                  );

                  resetAnalysis();
                }}
                className="w-full rounded-lg border px-3 py-2"
              >
                <option value="2025">
                  2025
                </option>

                <option value="2024">
                  2024
                </option>

                <option value="2023">
                  2023
                </option>

                <option value="2022">
                  2022
                </option>

                <option value="2021">
                  2021
                </option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                재무제표
              </label>

              <select
                disabled={analyzing || statementEvidenceLoading || financeEvidenceLoading || financeLoading}
                value={fsDiv}
                onChange={(
                  event
                ) => {
                  setFsDiv(
                    event.target.value
                  );

                  resetAnalysis();
                }}
                className="w-full rounded-lg border px-3 py-2"
              >
                <option value="CFS">
                  연결
                </option>

                <option value="OFS">
                  별도
                </option>
              </select>
            </div>
          </div>

          <button
            onClick={
              runStatementAnalysis
            }
            disabled={
              !selectedCompany ||
              analyzing || statementEvidenceLoading || financeEvidenceLoading || financeLoading
            }
            className="mt-5 rounded-lg bg-gray-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {analyzing
              ? "DART 분석 중..."
              : "IFRS 18 전체 분석 실행"}
          </button>
        </section>

        {error && (
          <div className="mb-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {analyzing && (
          <section className="rounded-xl border bg-white p-12 text-center">
            <p className="font-medium">
              손익계산서 전체를
              분석하고 있습니다.
            </p>
          </section>
        )}

        {statement && (
          <>
            <section className="mb-8 grid gap-4 md:grid-cols-5">
              <div className="rounded-xl border bg-white p-5">
                <p className="text-sm text-gray-500">
                  대상 회사
                </p>

                <p className="mt-2 font-semibold">
                  {statement.company}
                </p>
              </div>

              <div className="rounded-xl border bg-white p-5">
                <p className="text-sm text-gray-500">
                  사업연도
                </p>

                <p className="mt-2 font-semibold">
                  {statement.year}
                </p>
              </div>

              <div className="rounded-xl border bg-white p-5">
                <p className="text-sm text-gray-500">
                  분석 기준
                </p>

                <p className="mt-2 font-semibold">
                  {
                    statement.statement_type
                  }
                </p>
              </div>

              <div className="rounded-xl border bg-white p-5">
                <p className="text-sm text-gray-500">
                  DART 원천
                </p>

                <p className="mt-2 font-semibold">
                  {
                    statement.source_statement_name
                  }{" "}
                  (
                  {
                    statement.source_statement
                  }
                  )
                </p>
              </div>

              <div className="rounded-xl border bg-white p-5">
                <p className="text-sm text-gray-500">
                  검토 진행
                </p>

                <p className="mt-2 font-semibold">
                  {completedCount}
                  {" / "}
                  {reviewCount}
                </p>
              </div>
            </section>

            <section className="mb-8 rounded-xl border bg-white p-6">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    손익계산서 전체
                    IFRS 18 워크시트
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    일반 금액:
                    백만원 ·
                    주당손익:
                    원/주
                  </p>
                </div>

                <div className="flex gap-6 text-right text-sm">
                  <div>
                    <p className="text-gray-500">
                      검토 대상
                    </p>

                    <p className="font-semibold">
                      {
                        statement.counts
                          .review_candidates
                      }
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500">
                      주석 근거 조회
                    </p>

                    <p className="font-semibold">
                      {
                        statementEvidenceCount
                      }
                      {" / "}
                      {reviewRows.length}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500">
                      포괄손익 분리
                    </p>

                    <p className="font-semibold">
                      {
                        statement.counts
                          .total_excluded_rows
                      }
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left">
                      <th className="p-3">
                        #
                      </th>

                      <th className="p-3">
                        계정
                      </th>

                      <th className="p-3 text-right">
                        당기
                      </th>

                      <th className="p-3 text-right">
                        전기
                      </th>

                      <th className="p-3">
                        단위
                      </th>

                      <th className="p-3">
                        검토영역
                      </th>

                      <th className="p-3">
                        주석 근거
                      </th>

                      <th className="p-3">
                        IFRS 18 분류
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {[...statement.statement_rows].sort((a,b) => originalOrder ? a.source_index - b.source_index : a.display_order - b.display_order).map(
                      (row) => {
                        const reviewable =
                          row.ifrs18_status ===
                          "검토 필요";

                        const selected =
                          selectedStatementRow
                            ?.display_order ===
                          row.display_order;

                        const decision =
                          getStatementDecision(
                            row
                          );

                        const evidenceLoaded =
                          Boolean(
                            statementEvidenceCache[
                              getStatementRowKey(
                                row
                              )
                            ]
                          );

                        return (
                          <tr
                            key={`${row.display_order}-${row.account}`}
                            onClick={() => {
                              if (
                                reviewable
                              ) {
                                selectStatementRow(
                                  row
                                );
                              }
                            }}
                            className={`border-b ${
                              row.ifrs18_status ===
                              "요약"
                                ? "bg-gray-50 font-semibold"
                                : reviewable
                                  ? "cursor-pointer hover:bg-blue-50"
                                  : ""
                            } ${
                              selected
                                ? "bg-blue-50"
                                : ""
                            }`}
                          >
                            <td className="p-3 text-gray-400">
                              {
                                row.display_order
                              }
                            </td>

                            <td className="p-3">
                              {
                                row.display_account
                              }

                              {getFinanceSection(
                                row.account
                              ) && (
                                <span className="ml-2 rounded bg-blue-100 px-2 py-1 text-[11px] text-blue-700">
                                  세부계정
                                </span>
                              )}

                              {row.display_account !==
                                row.account && (
                                <p className="mt-1 text-[11px] font-normal text-gray-400">
                                  DART:{" "}
                                  {
                                    row.account
                                  }
                                </p>
                              )}
                            </td>

                            <td className="p-3 text-right tabular-nums">
                              {formatStatementValue(
                                row,
                                row.current_amount
                              )}
                            </td>

                            <td className="p-3 text-right tabular-nums">
                              {formatStatementValue(
                                row,
                                row.prior_amount
                              )}
                            </td>

                            <td className="p-3 text-xs text-gray-500">
                              {
                                row.display_unit
                              }
                            </td>

                            <td className="p-3 text-gray-600">
                              {
                                row.review_area
                              }
                            </td>

                            <td className="p-3">
                              {!reviewable ? (
                                <span className="text-gray-400">
                                  -
                                </span>
                              ) : evidenceLoaded ? (
                                <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                                  {decisionStatus(decision)} · 근거 조회됨
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">
                                  {decisionStatus(decision)} · 근거 미조회
                                </span>
                              )}
                            </td>

                            <td className="p-3">
                              {!reviewable ? (
                                <span className="text-gray-400">
                                  -
                                </span>
                              ) : getFinanceSection(row.account) ? (<span className="text-xs text-blue-700">세부계정별 분류 필요</span>) : decision.classification ? (
                                <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                                  {
                                    decision.classification
                                  }
                                </span>
                              ) : row.category_hint ? (
                                <span className="rounded-full bg-purple-100 px-2 py-1 text-xs text-purple-700">
                                  힌트:{" "}
                                  {
                                    row.category_hint
                                  }
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">
                                  미분류
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {selectedStatementRow && (
              <section
                id="statement-review-panel"
                className="mb-8 scroll-mt-6 rounded-xl border bg-white p-6"
              >
                <div className="mb-6">
                  <p className="text-sm font-medium text-blue-600">
                    Statement Review
                  </p>

                  <h2 className="mt-1 text-2xl font-semibold">
                    {
                      selectedStatementRow.display_account
                    }
                  </h2>

                  <p className="mt-2 text-sm text-gray-500">
                    당기{" "}
                    {formatStatementValue(
                      selectedStatementRow,
                      selectedStatementRow.current_amount
                    )}{" "}
                    {
                      selectedStatementRow.display_unit
                    }
                  </p>
                </div>

                <div className="mb-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">
                      검토 이유
                    </p>

                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      {
                        selectedStatementRow.review_reason
                      }
                    </p>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-800">
                      다음 검토
                    </p>

                    <p className="mt-2 text-sm leading-6 text-gray-600">
                      {selectedStatementRow.next_action ??
                        "-"}
                    </p>
                  </div>
                </div>

                {selectedStatementRow.category_hint && (
                  <div className="mb-6 rounded-lg border border-purple-200 bg-purple-50 p-4">
                    <p className="text-sm font-semibold text-purple-800">
                      시스템 힌트
                    </p>

                    <p className="mt-2 text-sm text-purple-700">
                      계정명에서{" "}
                      <strong>
                        {
                          selectedStatementRow.category_hint
                        }
                      </strong>
                      에 해당할 가능성이
                      식별됐습니다.
                      Reviewer가 최종
                      판단합니다.
                    </p>
                  </div>
                )}

                {/* 범용 주석 근거 */}

                <div className="mb-8">
                  <div className="mb-4">
                    <p className="text-sm font-medium text-blue-600">
                      DART Evidence
                    </p>

                    <h3 className="mt-1 text-lg font-semibold">
                      관련 주석 근거
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                      주석 제목,
                      계정명, 금액,
                      관련 표를 함께
                      비교해 가장 직접적인
                      근거를 찾습니다.
                    </p>
                  </div>

                  {statementEvidenceLoading && (
                    <div className="rounded-lg bg-gray-50 p-8 text-center text-sm">
                      관련 DART 주석을
                      탐색하고 있습니다.
                    </div>
                  )}

                  {statementEvidenceError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {
                        statementEvidenceError
                      }
                    </div>
                  )}

                  {!statementEvidenceLoading &&
                    statementEvidence &&
                    primaryStatementEvidence && (
                      <div className="rounded-xl border border-green-200 bg-green-50/30 p-5">
                        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-green-700">
                              1순위 관련 주석
                            </p>

                            <h4 className="mt-1 text-lg font-semibold text-gray-900">
                              주석{" "}
                              {
                                primaryStatementEvidence.note_number
                              }{" "}
                              ·{" "}
                              {
                                primaryStatementEvidence.note_title
                              }
                            </h4>

                            <p className="mt-2 text-sm text-gray-500">
                              {
                                statementEvidence.review_reason
                              }
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                              {getEvidenceTypeLabel(
                                primaryStatementEvidence.evidence_type
                              )}
                            </span>

                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                              검색 점수{" "}
                              {
                                primaryStatementEvidence.score
                              }
                            </span>
                          </div>
                        </div>

                        <p className="mb-5 text-xs leading-5 text-gray-500">
                          근거 대사 강도: {statementEvidence.primary_confidence ?? "근거 없음"}. verified/reconciled는 분류 판단의 정확도를 의미하지 않습니다. 검색 점수는 관련
                          주석 탐색을 위한
                          우선순위 값이며
                          IFRS 18 회계처리의
                          적정성을 평가하는
                          점수가 아닙니다.
                        </p>

                        {primaryStatementEvidence.tables.length >
                          0 && (
                          <div className="space-y-7">
                            {primaryStatementEvidence.tables.map(
                              (
                                table,
                                index
                              ) => (
                                <div
                                  key={
                                    table.table_index
                                  }
                                >
                                  {table.reconciliation && <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm"><strong>구조적 대사 · {table.reconciliation.matched ? "일치" : "불일치"}</strong><p>{table.reconciliation.components.map(c => c.label + " " + c.amount.toLocaleString("ko-KR")).join(" + ")} = {table.reconciliation.calculated_amount.toLocaleString("ko-KR")} {table.reconciliation.unit}</p><p>재무제표 {table.reconciliation.target_amount.toLocaleString("ko-KR")} · 차이 {table.reconciliation.difference.toLocaleString("ko-KR")}</p></div>}
                                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-sm font-semibold text-gray-800">
                                      근거 표{" "}
                                      {index +
                                        1}
                                    </p>

                                    <div className="flex gap-2">
                                      {table.direct_account_match && (
                                        <span className="rounded-full bg-blue-100 px-2 py-1 text-[11px] text-blue-700">
                                          계정명 일치
                                        </span>
                                      )}

                                      {table.amount_match && (
                                        <span className="rounded-full bg-green-100 px-2 py-1 text-[11px] text-green-700">
                                          금액 일치
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <EvidenceTableView
                                    table={
                                      table
                                    }
                                    account={
                                      selectedStatementRow.account
                                    }
                                  />
                                </div>
                              )
                            )}
                          </div>
                        )}

                        {primaryStatementEvidence.paragraphs.length >
                          0 && (
                          <div className="mt-7">
                            <p className="mb-3 text-sm font-semibold">
                              관련 설명
                            </p>

                            <div className="space-y-3">
                              {primaryStatementEvidence.paragraphs.map(
                                (
                                  paragraph,
                                  index
                                ) => (
                                  <div
                                    key={
                                      index
                                    }
                                    className="rounded-lg bg-white p-4 text-sm leading-7 text-gray-700"
                                  >
                                    {
                                      paragraph.text
                                    }
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  {!statementEvidenceLoading &&
                    statementEvidence &&
                    !primaryStatementEvidence && (
                      <div className="rounded-lg border border-dashed p-5 text-sm text-gray-500">
                        직접 연결할 수 있는
                        관련 주석을 찾지
                        못했습니다.
                      </div>
                    )}
                </div>

                {/* 금융수익 / 금융비용은 기존 전문 파서도 유지 */}

                {selectedFinanceSection && (
                  <div className="mb-8">
                    <div className="mb-4">
                      <p className="text-sm font-medium text-blue-600">
                        Finance Detail
                      </p>

                      <h3 className="mt-1 text-lg font-semibold">
                        {
                          selectedFinanceSection
                        }{" "}
                        세부계정
                      </h3>

                      <p className="mt-1 text-sm text-gray-500">
                        금융수익·금융비용은
                        주석 구성 항목까지
                        한 단계 더
                        분해합니다.
                      </p>
                    </div>

                    {financeLoading && (
                      <div className="rounded-lg bg-gray-50 p-8 text-center text-sm">
                        금융수익·금융비용
                        주석을 분석하고
                        있습니다.
                      </div>
                    )}

                    {!financeLoading &&
                      financeAnalysis && (
                        <div className="overflow-x-auto rounded-lg border">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="border-b bg-gray-50 text-left">
                                <th className="p-3">
                                  계정
                                </th>

                                <th className="p-3 text-right">
                                  당기
                                </th>

                                <th className="p-3 text-right">
                                  전기
                                </th>

                                <th className="p-3">
                                  상태
                                </th>

                                <th className="p-3">
                                  분류
                                </th>
                              </tr>
                            </thead>

                            <tbody>
                              {visibleFinanceRows.map(
                                (
                                  row,
                                  index
                                ) => {
                                  const clickable =
                                    row.ifrs18_status !==
                                    "합계";

                                  const financeDecision =
                                    getFinanceDecision(
                                      row
                                    );

                                  return (
                                    <tr
                                      key={`${row.account}-${index}`}
                                      onClick={() => {
                                        if (
                                          clickable
                                        ) {
                                          loadFinanceEvidence(
                                            row
                                          );
                                        }
                                      }}
                                      className={`border-b ${
                                        clickable
                                          ? "cursor-pointer hover:bg-blue-50"
                                          : "bg-gray-50"
                                      }`}
                                    >
                                      <td className="p-3 font-medium">
                                        {
                                          row.account
                                        }
                                      </td>

                                      <td className="p-3 text-right">
                                        {formatDetailAmount(
                                          row.current_amount
                                        )}
                                      </td>

                                      <td className="p-3 text-right">
                                        {formatDetailAmount(
                                          row.prior_amount
                                        )}
                                      </td>

                                      <td className="p-3">
                                        {
                                          row.ifrs18_status
                                        }
                                      </td>

                                      <td className="p-3">
                                        {row.ifrs18_status ===
                                        "합계" ? (
                                          "-"
                                        ) : financeDecision.classification ? (
                                          <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">
                                            {
                                              financeDecision.classification
                                            }
                                          </span>
                                        ) : (
                                          <span className="text-xs text-gray-400">
                                            미분류
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                }
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                  </div>
                )}

                {/* Reviewer Decision */}

                <div className="rounded-xl border-2 border-gray-900 p-6">
                  <p className="text-sm font-medium text-gray-500">
                    Reviewer Decision
                  </p>

                  <h3 className="mt-1 text-xl font-semibold">
                    {selectedFinanceSection ? "세부계정별 분류 필요" : "IFRS 18 분류 판단"}
                  </h3>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {(
                      [
                        "영업",
                        "투자",
                        "재무",
                        "법인세",
                        "중단영업",
                        "추가검토",
                      ] as ReviewCategory[]
                    ).map(
                      (category) => {
                        const active =
                          getStatementDecision(
                            selectedStatementRow
                          )
                            .classification ===
                          category;

                        return (
                          <button
                            disabled={Boolean(selectedFinanceSection)}
                            key={category}
                            onClick={() =>
                              setStatementClassification(
                                selectedStatementRow,
                                category
                              )
                            }
                            className={`rounded-lg border px-3 py-3 text-sm font-semibold ${
                              active
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "bg-white hover:bg-gray-50"
                            }`}
                          >
                            {
                              category
                            }
                          </button>
                        );
                      }
                    )}
                  </div>

                  {!selectedFinanceSection && <div className="mt-4 flex gap-3 items-center"><label htmlFor="statement-review-status">검토 상태</label><select id="statement-review-status" className="rounded border p-2" value={decisionStatus(getStatementDecision(selectedStatementRow))} onChange={event => setDecisionStatus(getStatementRowKey(selectedStatementRow), event.target.value as ReviewDecision["review_status"])}>{statuses.map(status=><option key={status}>{status}</option>)}</select><button className="text-sm underline" onClick={()=>setStatementClassification(selectedStatementRow,null)}>분류 초기화</button></div>}
                  <textarea aria-label="계정 검토 메모"
                    value={
                      getStatementDecision(
                        selectedStatementRow
                      ).memo
                    }
                    onChange={(
                      event
                    ) =>
                      setStatementMemo(
                        selectedStatementRow,
                        event.target.value
                      )
                    }
                    rows={5}
                    placeholder="검토 근거와 판단 이유를 기록하세요."
                    className="mt-5 w-full rounded-lg border p-3 text-sm leading-6"
                  />

                  {saveStatus && (
                    <p className="mt-3 text-xs font-medium text-green-700">
                      {saveStatus}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* 금융 세부계정 Evidence */}

            {selectedFinanceRow && (
              <section
                id="finance-evidence-panel"
                className="mb-8 scroll-mt-6 rounded-xl border bg-white p-6"
              >
                <p className="text-sm font-medium text-blue-600">
                  Finance Evidence
                </p>

                <h2 className="mt-1 text-xl font-semibold">
                  {
                    selectedFinanceRow.category
                  }{" "}
                  ·{" "}
                  {
                    selectedFinanceRow.account
                  }
                </h2>

                <p className="mt-2 text-sm text-gray-500">
                  당기{" "}
                  {formatDetailAmount(
                    selectedFinanceRow.current_amount
                  )}{" "}
                  백만원
                </p>

                {financeEvidenceLoading && (
                  <div className="mt-6 rounded-lg bg-gray-50 p-8 text-center text-sm">
                    관련 DART 근거를
                    찾고 있습니다.
                  </div>
                )}

                {financeEvidenceError && (
                  <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                    {
                      financeEvidenceError
                    }
                  </div>
                )}

                {financeEvidence &&
                  !financeEvidenceLoading && (
                    <>
                      <div className="mt-6 rounded-lg bg-amber-50 p-4">
                        <p className="text-sm font-semibold text-amber-900">
                          검토 목적
                        </p>

                        <p className="mt-2 text-sm leading-6 text-amber-800">
                          {
                            financeEvidence.review_reason
                          }
                        </p>
                      </div>

                      <div className="mt-8">
                        <h3 className="mb-3 font-semibold">
                          ① 금액 확인
                        </h3>

                        {financeEvidence.amount_evidence ? (
                          <>
                            <p className="mb-3 text-sm text-gray-500">
                              주석{" "}
                              {
                                financeEvidence
                                  .amount_evidence
                                  .note_number
                              }{" "}
                              ·{" "}
                              {
                                financeEvidence
                                  .amount_evidence
                                  .note_title
                              }
                            </p>

                            <EvidenceTableView
                              table={
                                financeEvidence
                                  .amount_evidence
                                  .table
                              }
                              account={
                                financeEvidence.account
                              }
                            />
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">
                            직접적인 금액
                            대사표를 찾지
                            못했습니다.
                          </p>
                        )}
                      </div>

                      <div className="mt-8">
                        <h3 className="mb-3 font-semibold">
                          ② 발생원천 분해
                        </h3>

                        {financeEvidence.classification_evidence ? (
                          <>
                            <p className="mb-3 text-sm text-gray-500">
                              주석{" "}
                              {
                                financeEvidence
                                  .classification_evidence
                                  .note_number
                              }{" "}
                              ·{" "}
                              {
                                financeEvidence
                                  .classification_evidence
                                  .note_title
                              }
                            </p>

                            <EvidenceTableView
                              table={
                                financeEvidence
                                  .classification_evidence
                                  .table
                              }
                              account={
                                financeEvidence.account
                              }
                            />
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">
                            발생원천을
                            세분화한 표를
                            찾지 못했습니다.
                          </p>
                        )}
                      </div>

                      <div className="mt-8">
                        <h3 className="mb-3 font-semibold">
                          ③ 관련 설명
                        </h3>

                        {financeEvidence.contextual_evidence ? (
                          <div className="rounded-lg bg-gray-50 p-4 text-sm leading-7">
                            <p className="mb-2 font-medium">
                              주석{" "}
                              {
                                financeEvidence
                                  .contextual_evidence
                                  .note_number
                              }{" "}
                              ·{" "}
                              {
                                financeEvidence
                                  .contextual_evidence
                                  .note_title
                              }
                            </p>

                            {
                              financeEvidence
                                .contextual_evidence
                                .text
                            }
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">
                            관련 설명을
                            찾지 못했습니다.
                          </p>
                        )}
                      </div>

                    </>
                  )}
                      <div className="mt-8 rounded-xl border-2 border-gray-900 p-6">
                        <p className="mb-2 text-sm text-gray-600">근거 대사 강도: {financeEvidence?.primary_confidence ?? "근거 미확인"} · 분류 판단은 Reviewer가 수행합니다.</p>
                        <h3 className="text-lg font-semibold">
                          ④ 세부계정 IFRS 18 판단
                        </h3>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                          {(
                            [
                              "영업",
                              "투자",
                              "재무",
                              "법인세",
                              "중단영업",
                              "추가검토",
                            ] as ReviewCategory[]
                          ).map(
                            (
                              category
                            ) => {
                              const active =
                                getFinanceDecision(
                                  selectedFinanceRow
                                )
                                  .classification ===
                                category;

                              return (
                                <button
                                  key={
                                    category
                                  }
                                  onClick={() =>
                                    setFinanceClassification(
                                      selectedFinanceRow,
                                      category
                                    )
                                  }
                                  className={`rounded-lg border px-3 py-3 text-sm font-semibold ${
                                    active
                                      ? "bg-gray-900 text-white"
                                      : "bg-white hover:bg-gray-50"
                                  }`}
                                >
                                  {
                                    category
                                  }
                                </button>
                              );
                            }
                          )}
                        </div>

                        <div className="mt-4 flex gap-3 items-center"><label htmlFor="finance-review-status">검토 상태</label><select id="finance-review-status" className="rounded border p-2" value={decisionStatus(getFinanceDecision(selectedFinanceRow))} onChange={event => setDecisionStatus(getFinanceRowKey(selectedFinanceRow), event.target.value as ReviewDecision["review_status"])}>{statuses.map(status=><option key={status}>{status}</option>)}</select><button className="text-sm underline" onClick={()=>setFinanceClassification(selectedFinanceRow,null)}>분류 초기화</button></div>
                        <textarea aria-label="금융 세부계정 검토 메모"
                          value={
                            getFinanceDecision(
                              selectedFinanceRow
                            ).memo
                          }
                          onChange={(
                            event
                          ) =>
                            setFinanceMemo(
                              selectedFinanceRow,
                              event.target.value
                            )
                          }
                          rows={4}
                          placeholder="세부계정의 발생원천과 판단 근거를 기록하세요."
                          className="mt-5 w-full rounded-lg border p-3 text-sm"
                        />
                      </div>

              </section>
            )}

            {/* 제외된 포괄손익 */}

            <section className="rounded-xl border bg-white p-6">
              <button
                onClick={() =>
                  setShowExcluded(
                    (previous) =>
                      !previous
                  )
                }
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <h2 className="text-lg font-semibold">
                    손익계산서 범위에서
                    분리된 포괄손익 표시항목
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    OCI 구성항목{" "}
                    {
                      statement.counts
                        .excluded_oci_rows
                    }
                    개 ·
                    포괄손익 표시항목{" "}
                    {
                      statement.counts
                        .excluded_comprehensive_rows
                    }
                    개
                  </p>
                </div>

                <span className="text-sm text-gray-500">
                  {showExcluded
                    ? "접기"
                    : "보기"}
                </span>
              </button>

              {showExcluded && (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left">
                        <th className="p-3">
                          유형
                        </th>

                        <th className="p-3">
                          계정
                        </th>

                        <th className="p-3 text-right">
                          당기
                        </th>

                        <th className="p-3 text-right">
                          전기
                        </th>

                        <th className="p-3">
                          분리 사유
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {excludedRows.map(
                        (
                          row,
                          index
                        ) => (
                          <tr
                            key={`${row.exclusion_type}-${row.account}-${index}`}
                            className="border-b"
                          >
                            <td className="p-3">
                              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                                {
                                  row.exclusion_type
                                }
                              </span>
                            </td>

                            <td className="p-3 font-medium">
                              {
                                row.account
                              }
                            </td>

                            <td className="p-3 text-right">
                              {formatExcludedValue(
                                row.current_amount
                              )}
                            </td>

                            <td className="p-3 text-right">
                              {formatExcludedValue(
                                row.prior_amount
                              )}
                            </td>

                            <td className="p-3 text-gray-600">
                              {
                                row.exclusion_reason
                              }
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {!statement &&
          !analyzing && (
            <section className="rounded-xl border border-dashed bg-white p-12 text-center">
              <p className="font-medium text-gray-700">
                회사와 사업연도를
                선택한 뒤 IFRS 18
                전체 분석을
                실행해주세요.
              </p>
            </section>
          )}
      </div>
    </main>
  );
}
