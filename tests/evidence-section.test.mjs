import { expect, test } from 'bun:test';
import { otherIncomeExpenseSection, tableGrid, numberFromText } from '../lib/evidence.ts';

const c = (text, row_span = 1, col_span = 1, header = false) => ({text, row_span, col_span, header});
// Samsung 2025 CFS, note 23: category totals precede the rowspan detail groups.
const samsung = [
  [c('', 1, 1, true), c('', 1, 1, true), c('공시금액', 1, 1, true)],
  [c('기타수익', 1, 2), c('2,267,083')],
  [c('기타수익', 4), c('배당금수익'), c('122,972')],
  [c('임대료수익'), c('149,828')],
  [c('유형자산처분이익'), c('115,940')],
  [c('기타'), c('1,878,343')],
  [c('기타비용', 1, 2), c('1,575,901')],
  [c('기타비용', 3), c('유형자산처분손실'), c('57,404')],
  [c('기부금'), c('211,720')],
  [c('기타'), c('1,306,777')],
];

test('top total preserves all four other-income components and merged cells', () => {
  const rows = otherIncomeExpenseSection(samsung, 1, '기타수익');
  expect(rows).toEqual(samsung.slice(0, 6));
  expect(rows[2][0].row_span).toBe(4);
  const grid = tableGrid(rows);
  expect(grid).toHaveLength(rows.length);
  expect(grid.slice(2).map(r => r[1].text)).toEqual(['배당금수익', '임대료수익', '유형자산처분이익', '기타']);
  expect(grid.slice(2).reduce((sum,r) => sum + numberFromText(r[2].text), 0)).toBe(2267083);
});

test('other-expense selection excludes income and retains all three expense components', () => {
  const rows = otherIncomeExpenseSection(samsung, 6, '기타비용');
  expect(rows).toEqual([samsung[0], ...samsung.slice(6)]);
  const grid = tableGrid(rows);
  expect(grid).toHaveLength(rows.length);
  expect(grid.slice(2).reduce((sum,r) => sum + numberFromText(r[2].text), 0)).toBe(1575901);
  // A match on the merged category cell must include its preceding total as well.
  expect(otherIncomeExpenseSection(samsung, 7, '기타비용')).toEqual(rows);
});

test('bottom totals retain the existing income/expense boundaries, including duplicate source rows', () => {
  const rows = [[c('구분',1,1,true),c('당기',1,1,true)], [c('처분이익'),c('10')],
    [c('기타'),c('5')], [c('기타'),c('5')], [c('기타영업외수익 합계'),c('20')],
    [c('기부금'),c('3')], [c('기타'),c('2')], [c('기타영업외비용 합계'),c('5')]];
  expect(otherIncomeExpenseSection(rows,4,'기타영업외수익')).toEqual(rows.slice(0,5));
  expect(otherIncomeExpenseSection(rows,7,'기타영업외비용')).toEqual([rows[0],...rows.slice(5)]);
  expect(otherIncomeExpenseSection(rows,4,'매출액')).toBeNull();
  expect(otherIncomeExpenseSection(rows,-1,'기타수익')).toBeNull();
});
