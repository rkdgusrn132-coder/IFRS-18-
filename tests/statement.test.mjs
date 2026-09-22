import {test,expect} from 'bun:test';
import {GET} from '../app/api/ifrs18-statement/route.ts';
test('IS is primary while CIS OCI remains separate; raw values and discontinued operations survive',async()=>{
 const originalFetch=globalThis.fetch, originalKey=process.env.DART_API_KEY;
 process.env.DART_API_KEY='unit-test-placeholder';
 const base={rcept_no:'20260301000001',corp_name:'테스트회사',currency:'KRW',thstrm_amount:'1000000',frmtrm_amount:'2000000'};
 const list=[{...base,sj_div:'IS',account_nm:'매출액',account_id:'Revenue',ord:'1'},{...base,sj_div:'IS',account_nm:'중단영업손실',account_id:'Discontinued',ord:'2'},{...base,sj_div:'IS',account_nm:'기본주당이익',account_id:'BasicEarningsLossPerShare',thstrm_amount:'250',ord:'3'},{...base,sj_div:'CIS',account_nm:'매출액',account_id:'Revenue',ord:'1'},{...base,sj_div:'CIS',account_nm:'해외사업환산손익',account_id:'othercomprehensiveincome',ord:'4'},{...base,sj_div:'CIS',account_nm:'총포괄손익',account_id:'TotalComprehensiveIncome',ord:'5'}];
 globalThis.fetch=async url=>Response.json(String(url).includes('fnlttSinglAcntAll')?{status:'000',list}:{status:'000',total_page:1,list:[{rcept_no:base.rcept_no,report_nm:'사업보고서 (2025.12)',rcept_dt:'20260301',corp_name:'테스트회사'}]});
 try {
  const response=await GET(new Request('http://localhost/api/ifrs18-statement?corp_code=00000099&year=2025&fs_div=CFS'));
  const d=await response.json();expect(response.status).toBe(200);expect(d.source_statement).toBe('IS');expect(d.statement_rows.length).toBe(3);expect(d.excluded_oci_rows.length).toBe(1);expect(d.excluded_comprehensive_rows.length).toBe(1);
  expect(d.statement_rows.find(r=>r.account==='기본주당이익').current_amount).toBe(250);
  expect(d.statement_rows.find(r=>r.account==='중단영업손실').ifrs18_status).toBe('검토 필요');
  expect(d.statement_rows[0].current_amount_raw).toBe('1000000');expect(d.statement_rows.every(r=>r.provisional_category===null)).toBe(true);
  delete process.env.DART_API_KEY;
  const missing=await GET(new Request('http://localhost/api/ifrs18-statement?corp_code=00000099'));
  expect(missing.status).toBe(500);expect((await missing.json()).error).toContain('DART_API_KEY');
 } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.DART_API_KEY;else process.env.DART_API_KEY=originalKey;}
});
