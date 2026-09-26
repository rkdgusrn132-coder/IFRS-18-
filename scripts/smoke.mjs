import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {getStatementRowKey,getFinanceRowKey} from '../lib/review.ts';
const base=process.env.TEST_BASE_URL??'http://localhost:3000';
const scope={corp_code:'00164779',corp_name:'SK하이닉스',year:'2025',fs_div:'CFS'};
async function get(route,params){const r=await fetch(base+'/api/'+route+'?'+new URLSearchParams(params));const d=await r.json();assert.equal(r.status,200,d.error);return d;}
const found=await get('company-search',{q:'000660'});assert(found.results.some(r=>r.corp_code===scope.corp_code));
const s=await get('ifrs18-statement',scope);assert(s.report.rcept_no);assert(s.excluded_oci_rows.length>0);assert(s.excluded_comprehensive_rows.length>0);
const expected={'매출액':97146675,'매출원가':38455885,'판매비와관리비':11484471,'영업이익(손실)':47206319,'기타영업외수익':333277,'기타영업외비용':377973,'금융수익':16373480,'금융비용':12504998,'지분법투자 관련 손익':-564553,'법인세비용(수익)':7517650,'당기순이익(손실)':42947902};
for(const [name,amount] of Object.entries(expected))assert.equal(s.statement_rows.find(r=>r.account===name)?.current_amount/1e6,amount,name);
assert(s.statement_rows.every(r=>r.provisional_category===null));assert(s.statement_rows.filter(r=>r.value_type==='per_share').every(r=>r.display_unit==='원/주'&&r.current_amount>1000));
console.log('PASS SK하이닉스: 11개 주요 금액, OCI, EPS, 접수번호');
const se={};for(const account of ['매출액','매출원가','지분법투자 관련 손익','기타영업외수익','기타영업외비용','판매비와관리비','법인세비용(수익)']) {
 const row=s.statement_rows.find(r=>r.account===account);
 const e=await get('ifrs18-statement-evidence',{...scope,rcept_no:s.rcept_no,account,current_amount:String(row.current_amount)});se[getStatementRowKey(row)]=e;
 assert.equal(e.report.rcept_no,s.rcept_no);
 if(account.startsWith('지분법')){assert.equal(e.primary_confidence,'reconciled');assert.equal(e.primary_evidence.tables[0].reconciliation.difference,0);assert.deepEqual(e.primary_evidence.tables[0].reconciliation.components.map(c=>c.amount),[-93545,-471008]);}
 if(account==='판매비와관리비'){assert.equal(e.primary_confidence,'verified');assert(e.primary_evidence.tables[0].focused_rows.length>=19);}
 if(account.startsWith('법인세'))assert.equal(e.primary_confidence,'verified');
 if(account.startsWith('기타영업외')){
  assert.equal(e.primary_confidence,'verified');const rows=e.primary_evidence.tables[0].focused_rows;const labels=rows.map(r=>r[0].text).join(' ');
  if(account.endsWith('수익')){assert(labels.includes('유형자산처분이익'));assert(!labels.includes('기부금'));}
  else {assert(labels.includes('기부금'));assert(!labels.includes('유형자산처분이익'));}
 }
 console.log('PASS 근거',account,e.primary_confidence);
}
const f=await get('ifrs18-analysis',{...scope,rcept_no:s.rcept_no});
const fe={};for(const item of f.financial_data.filter(r=>['이자수익','외환차이'].includes(r.account))){
 const e=await get('ifrs18-evidence',{...scope,rcept_no:s.rcept_no,account:item.account,category:item.category,current_amount:String(item.current_amount),unit:f.finance_note.unit});
 fe[getFinanceRowKey(item)]=e;assert.equal(e.report.rcept_no,s.rcept_no);assert(e.amount_evidence||e.classification_evidence);console.log('PASS 금융 근거',item.category,item.account,e.primary_confidence);
}
for(const category of ['금융수익','금융비용']){const rows=f.financial_data.filter(r=>r.category===category);assert.equal(rows.filter(r=>r.ifrs18_status!=='합계').reduce((n,r)=>n+r.current_amount,0),rows.find(r=>r.ifrs18_status==='합계').current_amount);}
const row=s.statement_rows.find(r=>r.account==='법인세비용(수익)');
const decisions={[getStatementRowKey(row)]:{classification:'법인세',memo:'자동 검증용 메모',review_status:'완료'}};
const payload={statement:s,financeAnalysis:f,reviewDecisions:decisions,statementEvidenceCache:se,financeEvidenceCache:fe};
const response=await fetch(base+'/api/export-xlsx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(response.status,200,await response.clone().text());
const buffer=Buffer.from(await response.arrayBuffer());await fs.mkdir('.tmp',{recursive:true});await fs.writeFile('.tmp/smoke-review.xlsx',buffer);
const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
assert.deepEqual(workbook.worksheets.map(w=>w.name),['Summary','전체 손익계산서','세부계정','Evidence','OCI','Reconciliation','Evidence 표']);
assert.equal(workbook.getWorksheet('Summary').getCell('B13').result,1);
const pl=workbook.getWorksheet('전체 손익계산서');let eps=0;pl.eachRow((r,i)=>{if(i===1)return;if(r.getCell(6).value==='원/주'){eps++;assert(r.getCell(4).value>1000);}if(r.getCell(3).value==='금융수익')assert(!r.getCell(9).dataValidation?.type);if(r.getCell(3).value==='법인세비용(수익)'){assert.equal(r.getCell(10).value,'자동 검증용 메모');assert(r.getCell(9).dataValidation.formulae[0].includes('중단영업'));}});assert(eps>0);assert.equal(workbook.getWorksheet('Reconciliation').getCell('J2').result,0);
console.log('PASS XLSX: 7개 시트, 대사 수식, 원본금액/EPS, 검토 메모, 드롭다운');
const samsung=await get('ifrs18-statement',{corp_code:'00126380',year:'2025',fs_div:'CFS'});assert(samsung.statement_rows.length>10);assert(samsung.report.rcept_no!==s.rcept_no);
const sales=samsung.statement_rows.find(r=>/매출액|수익\(매출액\)/.test(r.account));assert(sales);
const samsungEvidence=await get('ifrs18-statement-evidence',{corp_code:'00126380',year:'2025',fs_div:'CFS',rcept_no:samsung.rcept_no,account:sales.account,current_amount:String(sales.current_amount)});assert(samsungEvidence.candidate_count>0);
console.log('PASS 삼성전자 smoke:',samsung.statement_rows.length,'P/L rows',samsungEvidence.primary_confidence);
for (const [account, labels, total] of [
 ['기타수익', ['배당금수익','임대료수익','유형자산처분이익','기타'], 2267083],
 ['기타비용', ['유형자산처분손실','기부금','기타'], 1575901],
]) {
 const row=samsung.statement_rows.find(r=>r.account===account);assert(row);
 const e=await get('ifrs18-statement-evidence',{corp_code:'00126380',year:'2025',fs_div:'CFS',rcept_no:samsung.rcept_no,account,current_amount:String(row.current_amount)});
 const rows=e.primary_evidence.tables[0].focused_rows;
 assert.equal(e.primary_confidence,'verified');
 assert.equal(rows.length,labels.length+2);
 assert.deepEqual(rows.slice(2).map(r=>r.at(-2).text),labels);
 assert.equal(rows.slice(2).reduce((sum,r)=>sum+Number(r.at(-1).text.replaceAll(',','')),0),total);
 assert(!rows.flat().some(c=>c.text===(account==='기타수익'?'기타비용':'기타수익')));
 console.log('PASS 삼성전자',account,labels.length,'개 세부항목 및 합계');
}
const invalid=await fetch(base+'/api/ifrs18-statement?corp_code=bad&year=2025&fs_div=CFS');assert.equal(invalid.status,400);
const mismatch=await fetch(base+'/api/export-xlsx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,financeAnalysis:{...f,report:samsung.report}})});assert.equal(mismatch.status,409);
await fs.writeFile('.tmp/smoke-payload.json',JSON.stringify(payload));
console.log('PASS 잘못된 조건 400 / 접수번호 혼합 409');
