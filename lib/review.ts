import type { FinanceDetailRow, ReviewDecision, ReviewDecisionMap, StatementRow } from "./types";

export const categories = ["영업", "투자", "재무", "법인세", "중단영업", "추가검토"] as const;
export const statuses = ["미검토", "검토중", "완료"] as const;
export function getStatementRowKey(row: StatementRow) {
  return ["statement", row.source_statement, row.account_id ?? row.account, row.account_detail ?? "", row.account, row.source_index].join("::");
}
export function getFinanceRowKey(row: FinanceDetailRow) {
  return ["finance-detail", row.note_number, row.category, row.account, row.current_amount ?? "null"].join("::");
}
export function buildStorageKey(corp: string, year: string, fs: string, receipt: string) {
  return ["ifrs18-full-review-v3", corp, year, fs, receipt].join(":");
}
export const emptyDecision: ReviewDecision = { classification: null, memo: "", review_status: "미검토" };
export function decisionStatus(decision: ReviewDecision) {
  return decision.review_status ?? (decision.classification || decision.memo ? "검토중" : "미검토");
}
export function parseDecisions(raw: string | null): ReviewDecisionMap {
  if (!raw) return {};
  try {
    const envelope = JSON.parse(raw);
    if (envelope.version !== 3) return {};
    const result: ReviewDecisionMap = {};
    for (const entries of [envelope.statement, envelope.finance]) {
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
      for (const [key, value] of Object.entries(entries)) {
        if (!value || typeof value !== "object") continue;
        const d = value as ReviewDecision;
        if (typeof d.memo !== "string" || (d.classification !== null && !categories.includes(d.classification))) continue;
        const status = statuses.includes(d.review_status!) ? d.review_status : "미검토";
        result[key] = { classification: d.classification, memo: d.memo, review_status: status === "완료" && !d.classification ? "검토중" : status };
      }
    }
    return result;
  } catch { return {}; }
}
export function serializeDecisions(decisions: ReviewDecisionMap) {
  return JSON.stringify({ version: 3, statement: Object.fromEntries(Object.entries(decisions).filter(([k]) => k.startsWith("statement::"))), finance: Object.fromEntries(Object.entries(decisions).filter(([k]) => k.startsWith("finance-detail::"))) });
}
