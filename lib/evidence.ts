export type EvidenceCell = { text: string; row_span: number; col_span: number; header: boolean };
export type Reconciliation = {
  type: "equity_method_plus_impairment"; matched: boolean; target_amount: number; calculated_amount: number;
  difference: number; unit: string | null; components: { label: string; amount: number }[];
};
export const normalized = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export function numberFromText(value: string): number | null {
  let s = normalized(value).replaceAll(",", "");
  if (!s || s === "-" || s === "－") return null;
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
  s = s.replace(/^△/, "-");
  return /^-?\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
}
export function unitDivisor(unit: string | null) {
  const s = normalized(unit ?? "");
  if (s.includes("백만원")) return 1_000_000;
  if (s.includes("천원")) return 1_000;
  if (s.includes("억원")) return 100_000_000;
  return s === "원" ? 1 : null;
}
export function inferTableUnit(table: string, preceding: string) {
  const units = (s: string) => [...s.replace(/<[^>]+>/g, " ").matchAll(/단위\s*[:：]\s*([^)<]+)/g)];
  return (units(table)[0] ?? units(preceding).at(-1))?.[1]?.trim() ?? null;
}
/** Expand spans for semantic column addressing, retaining original cells for rendering. */
export function tableGrid(rows: EvidenceCell[][]) {
  const grid: EvidenceCell[][] = [];
  rows.forEach((row, r) => {
    grid[r] ??= []; let c = 0;
    for (const cell of row) {
      while (grid[r][c]) c++;
      const height = Math.min(Math.max(cell.row_span, 1), 100);
      const width = Math.min(Math.max(cell.col_span, 1), 100);
      for (let dy = 0; dy < height; dy++) {
        grid[r + dy] ??= [];
        for (let dx = 0; dx < width; dx++) grid[r + dy][c + dx] = cell;
      }
      c += width;
    }
  });
  return grid;
}
export function contextPeriod(preceding: string): "current" | "prior" | null {
  const text = preceding.normalize("NFKC").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");
  const periods = text.split("\n").map(line => line.trim().match(/^(?:\(?\d+\)?[.)]?\s*)?[<(（]?\s*(당기|전기)\s*[>)）]?$/)).filter(Boolean);
  const last = periods.at(-1)?.[1];
  return last === "당기" ? "current" : last === "전기" ? "prior" : null;
}
export function currentValue(rows: EvidenceCell[][], rowIndex: number, preceding: string) {
  const grid = tableGrid(rows); const row = grid[rowIndex];
  if (!row) return null;
  const headers = grid.slice(0, rowIndex);
  const columns = row.map((_, i) => i).filter(i => headers.some(r => /^(당기|당기말)$/.test(normalized(r[i]?.text ?? ""))));
  // Multiple current-period measure columns require an explicit total column.
  let chosen = columns.length === 1 ? columns[0] : columns.find(i => headers.some(r => /^(합계|총계)$/.test(normalized(r[i]?.text ?? ""))));
  if (chosen === undefined && columns.length === 0 && contextPeriod(preceding) === "current") {
    const numeric = row.map((cell, i) => ({cell, i})).filter(({cell, i}) => i > 0 && numberFromText(cell.text) !== null);
    if (numeric.length === 1) chosen = numeric[0].i;
  }
  return chosen === undefined ? null : numberFromText(row[chosen]?.text ?? "");
}
export function canonicalAccount(value: string) {
  return normalized(value).replace(/\((손실|이익|수익|비용|손익)\)/g, "").replace(/(합계|소계)$/, "");
}

/** Keep the complete income/expense section, including vertically merged detail labels. */
export function otherIncomeExpenseSection(rows: EvidenceCell[][], targetIndex: number, account: string): EvidenceCell[][] | null {
  const kind = (text: string) => {
    const name = canonicalAccount(text);
    if (/^기타(?:영업외)?수익$/.test(name)) return "income";
    if (/^기타(?:영업외)?비용$/.test(name)) return "expense";
    return null;
  };
  const targetKind = kind(account);
  if (!targetKind || targetIndex < 0 || targetIndex >= rows.length) return null;
  const grid = tableGrid(rows);
  const label = normalized(grid[targetIndex]?.[0]?.text ?? "");
  let start = targetIndex;
  let end = targetIndex + 1;
  if (/합계|소계|총계/.test(label)) {
    // Totals at the bottom: include the preceding details after the previous section's total.
    start = 0;
    for (let i = targetIndex - 1; i >= 0; i--) {
      const previous = normalized(grid[i]?.[0]?.text ?? "");
      if (/합계|소계|총계/.test(previous)) { start = i + 1; break; }
    }
  } else if (kind(label) === targetKind) {
    // Totals at the top: the following rows belong to this section until the other category.
    // tableGrid resolves rowspans so continuation rows retain their parent category.
    for (let i = targetIndex - 1; i >= 0; i--) {
      const previousKind = kind(grid[i]?.[0]?.text ?? "");
      if (previousKind && previousKind !== targetKind) break;
      if (previousKind === targetKind) start = i;
    }
    end = rows.length;
    for (let i = targetIndex + 1; i < rows.length; i++) {
      const nextKind = kind(grid[i]?.[0]?.text ?? "");
      if (nextKind && nextKind !== targetKind) { end = i; break; }
      if (nextKind === targetKind && /합계|소계|총계/.test(normalized(grid[i]?.[0]?.text ?? ""))) { end = i + 1; break; }
    }
  } else {
    return null;
  }
  // Select by row position, not text: identical labels/amounts may be distinct source rows.
  return rows.filter((row, i) => (i >= start && i < end) || (i < start && row.length > 0 && row.every(cell => cell.header)));
}

export function directAmountMatches(rows: EvidenceCell[][], index: number, raw: number | null, unit: string | null, preceding: string) {
  const divisor = unitDivisor(unit); const value = currentValue(rows, index, preceding);
  return raw !== null && divisor !== null && value !== null && Math.abs(value - raw / divisor) <= (divisor === 1 ? 0.00001 : 0.5);
}
export function equityReconciliation(rows: EvidenceCell[][], raw: number | null, unit: string | null, preceding: string): Reconciliation | null {
  if (raw === null || contextPeriod(preceding) !== "current") return null;
  const divisor = unitDivisor(unit); if (!divisor) return null;
  const grid = tableGrid(rows);
  const header = grid.findIndex(r => r.some(c => /지분법손익/.test(normalized(c.text))) && r.some(c => /손상차손/.test(normalized(c.text))) && r.some(c => /기초/.test(normalized(c.text))) && r.some(c => /기말/.test(normalized(c.text))));
  if (header < 0) return null;
  const equity = grid[header].findIndex(c => /지분법손익/.test(normalized(c.text)));
  const impairment = grid[header].findIndex(c => /손상차손/.test(normalized(c.text)));
  const total = grid.slice(header + 1).filter(r => /^(합계|합계액|총계)$/.test(normalized(r[0]?.text ?? "")));
  if (total.length !== 1) return null;
  const a = numberFromText(total[0][equity]?.text ?? "");
  const b = numberFromText(total[0][impairment]?.text ?? "");
  if (a === null || b === null) return null;
  const target = raw / divisor; const difference = a + b - target;
  return { type: "equity_method_plus_impairment", matched: Math.abs(difference) <= 0.5, target_amount: target, calculated_amount: a + b, difference, unit, components: [{label:"지분법손익",amount:a},{label:"손상차손",amount:b}] };
}
