import {test,expect} from 'bun:test';
import {canonicalAccount, contextPeriod, currentValue, directAmountMatches, equityReconciliation, inferTableUnit, tableGrid} from '../lib/evidence.ts';
import {buildStorageKey,serializeDecisions,parseDecisions,getStatementRowKey} from '../lib/review.ts';
import {cached} from '../lib/dart.ts';
const c=(text,header=false,col_span=1,row_span=1)=>({text,header,col_span,row_span});
test('signed amount, known unit and current period are all required',()=>{
 const rows=[[c('계정',true),c('당기',true),c('전기',true)],[c('금액'),c('(25)'),c('100')]];
 expect(directAmountMatches(rows,1,-25000000,'백만원','')).toBe(true);
 expect(directAmountMatches(rows,1,25000000,'백만원','')).toBe(false);
 expect(directAmountMatches(rows,1,100000000,'백만원','')).toBe(false);
 expect(directAmountMatches(rows,1,-25000000,null,'')).toBe(false);
});
test('single-period table uses the nearest explicit heading including circled numbers',()=>{
 const rows=[[c('계정'),c('10')]];
 expect(contextPeriod('<P>① 당기</P>')).toBe('current');
 expect(contextPeriod('<P>① 당기</P><P>② 전기</P>')).toBe('prior');
 expect(currentValue(rows,0,'<P>① 당기</P>')).toBe(10);
 expect(currentValue(rows,0,'<P>② 전기</P>')).toBe(null);
 expect(currentValue(rows,0,'')).toBe(null);
});
test('rowspan and colspan align current-period total columns',()=>{
 const rows=[[c('계정',true,1,2),c('당기',true,2),c('전기',true,1,2)],[c('부문',true),c('합계',true)],[c('수익'),c('5'),c('10'),c('8')]];
 expect(tableGrid(rows)[1][0].text).toBe('계정');
 expect(currentValue(rows,2,'')).toBe(10);
});
test('semantic equity reconciliation rejects prior period and non-movement tables',()=>{
 const rows=[[c('구분',true),c('기초',true),c('지분법손익',true),c('손상차손',true),c('기말',true)],[c('합계'),c('100'),c('(3)'),c('(7)'),c('90')]];
 const r=equityReconciliation(rows,-10000000,'백만원','<P>① 당기</P>');
 expect(r?.matched).toBe(true);expect(r?.difference).toBe(0);
 expect(equityReconciliation(rows,10000000,'백만원','<P>① 당기</P>')?.matched).toBe(false);
 expect(equityReconciliation(rows,-10000000,'백만원','<P>전기</P>')).toBe(null);
 expect(equityReconciliation([rows[1]],-10000000,'백만원','<P>당기</P>')).toBe(null);
});
test('unit nearest to table wins, account totals retain meaning',()=>{
 expect(inferTableUnit('<TABLE/>','<P>(단위: 원)</P><P>(단위: 백만원)</P>')).toBe('백만원');
 expect(canonicalAccount('법인세비용(수익)')).toBe(canonicalAccount('법인세비용 합계'));
});
test('receipt scopes and decision namespaces cannot collide; legacy data is not misapplied',()=>{
 expect(buildStorageKey('00164779','2025','CFS','20260317000635')).not.toBe(buildStorageKey('00164779','2025','CFS','20260917000635'));
 const values={'statement::one':{classification:'법인세',memo:'검토',review_status:'완료'},'finance-detail::one':{classification:null,memo:'진행',review_status:'검토중'}};
 expect(parseDecisions(serializeDecisions(values))).toEqual(values);
 expect(parseDecisions(JSON.stringify(values))).toEqual({});
 expect(parseDecisions('broken')).toEqual({});
 expect(parseDecisions(serializeDecisions({'statement::bad':{classification:null,memo:'',review_status:'완료'}}))['statement::bad'].review_status).toBe('검토중');
 const row={account:'기타',account_id:'custom',source_statement:'IS',source_index:1,account_detail:'A'};
 expect(getStatementRowKey(row)).not.toBe(getStatementRowKey({...row,account_detail:'B'}));
});
test('cache shares in-flight work and retries failures',async()=>{
 let calls=0;const loader=async()=>{calls++;return 42;};
 expect(await Promise.all([cached('unit-success',loader),cached('unit-success',loader)])).toEqual([42,42]);expect(calls).toBe(1);
 await expect(cached('unit-failure',()=>{throw Error('test');})).rejects.toThrow('test');
 expect(await cached('unit-failure',()=>7)).toBe(7);
});
