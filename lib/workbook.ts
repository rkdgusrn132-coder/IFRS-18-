import ExcelJS from "exceljs";
import { categories, decisionStatus, getFinanceRowKey, getStatementRowKey, statuses } from "./review";
import type { FinanceAnalysisResponse, FinanceEvidenceResponse, ReviewDecisionMap, StatementEvidenceCache, StatementResponse } from "./types";
import type { EvidenceCell, Reconciliation } from "./evidence";

export type ExportRequest = {
  statement: StatementResponse; financeAnalysis?: FinanceAnalysisResponse | null;
  reviewDecisions?: ReviewDecisionMap; statementEvidenceCache?: StatementEvidenceCache;
  financeEvidenceCache?: Record<string, FinanceEvidenceResponse>;
};
const parent = (name: string) => /금융수익|금융이익|금융비용|금융원가/.test(name);
function sheet(book: ExcelJS.Workbook, name: string, headers: string[], widths: number[]) {
  const ws = book.addWorksheet(name, {views:[{state:"frozen", ySplit:1, xSplit:name==="Summary"?0:2, showGridLines:false}]});
  ws.addRow(headers); ws.columns=widths.map(width=>({width})); ws.getRow(1).height=32;
  ws.getRow(1).eachCell(cell=> {
    cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1E293B"}};
    cell.font={name:"맑은 고딕",bold:true,color:{argb:"FFFFFFFF"}}; cell.alignment={vertical:"middle",wrapText:true};
  });
  return ws;
}
function reviewControls(row: ExcelJS.Row, enabled: boolean) {
  if (!enabled) return;
  for (const [column, values] of [[8,statuses],[9,categories]] as const) {
    const cell=row.getCell(column);
    cell.dataValidation={type:"list",allowBlank:true,formulae:['"'+values.join(",")+'"'],showErrorMessage:true,errorStyle:"stop",errorTitle:"선택값 확인",error:"목록에서 값을 선택하세요."};
    cell.font={color:{argb:"FF1D4ED8"}}; cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFEFF6FF"}};
  }
}
export async function buildWorkbook({statement:s,financeAnalysis:f,reviewDecisions:d={},statementEvidenceCache:se={},financeEvidenceCache:fe={}}:ExportRequest) {
  const book=new ExcelJS.Workbook(); book.creator="IFRS 18 검토 지원"; book.created=new Date(); book.calcProperties.fullCalcOnLoad=true;
  const summary=sheet(book,"Summary",["항목","내용"],[30,100]);
  const pl=sheet(book,"전체 손익계산서",["표시순서","DART 순서","계정","당기","전기","단위","검토영역","검토상태","IFRS 18 분류","Reviewer 메모","Evidence confidence","주석번호","주석제목","접수번호","원본 계정 ID","원본 당기","원본 전기","원본 재무제표","원본 인덱스"],[12,12,36,19,19,12,23,18,23,60,22,12,40,22,45,24,24,16,14]);
  const details=sheet(book,"세부계정",["구분","주석번호","계정","당기","전기","단위","검토포인트","검토상태","IFRS 18 분류","Reviewer 메모","Evidence confidence","접수번호"],[20,12,32,19,19,12,55,18,23,60,22,22]);
  const evidence=sheet(book,"Evidence",["계정","근거 유형","Confidence","주석번호","주석제목","일치 금액","단위","대사 여부","근거 요약","접수번호","근거 표 번호"],[32,28,18,12,40,20,12,14,80,22,16]);
  const oci=sheet(book,"OCI",["구분","DART 순서","계정","당기","전기","단위","제외 사유","접수번호"],[24,12,65,22,22,12,80,22]);
  const recon=sheet(book,"Reconciliation",["계정","주석번호","주석제목","구성요소 1","금액 1","구성요소 2","금액 2","합산","재무제표","차이","단위","일치","접수번호"],[30,12,36,24,20,24,20,20,20,18,12,12,22]);
  const tables=sheet(book,"Evidence 표",["근거 표 원문 (병합 구조 유지)"],[38,...Array.from({length:19},()=>20)]);
  let tableNumber=0;
  function addTable(account:string,note:string,title:string,rows:EvidenceCell[][],unit:string|null) {
    tableNumber++; tables.addRow([]);
    const heading=tables.addRow([`표 ${tableNumber} · ${account} · 주석 ${note} ${title} · ${unit??"단위 미확인"}`]);
    tables.mergeCells(heading.number,1,heading.number,Math.max(2,Math.min(12,rows[0]?.reduce((n,c)=>n+c.col_span,0)??2)));
    heading.font={bold:true};heading.height=42;heading.alignment={wrapText:true};
    const start=heading.number+1;const occupied=new Set<string>();
    rows.forEach((cells,ri)=> {
      let ci=1;
      for(const cell of cells) {
        while(occupied.has(`${ri}:${ci}`))ci++;
        const rs=Math.min(100,Math.max(1,cell.row_span)),cs=Math.min(100,Math.max(1,cell.col_span));
        const target=tables.getCell(start+ri,ci);target.value=cell.text.slice(0,32767);target.alignment={wrapText:true,vertical:"top"};
        if(cell.header){target.font={bold:true};target.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFE2E8F0"}};}
        if(rs>1||cs>1)tables.mergeCells(start+ri,ci,start+ri+rs-1,ci+cs-1);
        for(let r=0;r<rs;r++)for(let c=0;c<cs;c++)occupied.add(`${ri+r}:${ci+c}`);
        ci+=cs;
      }
    });
    return tableNumber;
  }
  function addReconciliation(account:string,note:string,title:string,r:Reconciliation) {
    const row=recon.addRow([account,note,title,r.components[0]?.label,r.components[0]?.amount,r.components[1]?.label,r.components[1]?.amount,null,r.target_amount,null,r.unit,r.matched?"일치":"불일치",s.rcept_no]);const n=row.number;
    row.getCell(8).value={formula:`E${n}+G${n}`,result:r.calculated_amount};
    row.getCell(10).value={formula:`H${n}-I${n}`,result:r.difference};
    row.getCell(12).value={formula:`IF(ABS(J${n})<=0.5,"일치","불일치")`,result:r.matched?"일치":"불일치"};
  }
  const counts:Record<string,number>={verified:0,reconciled:0,strong:0,review:0,미조회:0};let total=0,completed=0;
  for(const item of s.statement_rows) {
    const key=getStatementRowKey(item),decision=d[key]??{classification:null,memo:""},e=se[key],p=e?.primary_evidence;
    const enabled=item.ifrs18_status==="검토 필요"&&!parent(item.account);
    const status=enabled?decisionStatus(decision):parent(item.account)?"세부계정 검토":"요약";
    if(enabled){total++;if(status==="완료"&&decision.classification)completed++;}
    if(item.ifrs18_status==="검토 필요")counts[e?e.primary_confidence??"review":"미조회"]++;
    const divisor=item.value_type==="per_share"?1:1_000_000;
    const row=pl.addRow([item.display_order,item.dart_order,item.account,item.current_amount===null?null:item.current_amount/divisor,item.prior_amount===null?null:item.prior_amount/divisor,item.display_unit,item.review_area,status,enabled?decision.classification:parent(item.account)?"세부계정별 분류 필요":"",decision.memo,e?e.primary_confidence??"근거 없음":"미조회",p?.note_number,p?.note_title,s.rcept_no,item.account_id,item.current_amount,item.prior_amount,item.source_statement,item.source_index]);reviewControls(row,enabled);
    if(!e){if(item.ifrs18_status==="검토 필요")evidence.addRow([item.account,"미조회","","","",null,"","","웹앱에서 근거 조회 후 다시 내보내세요.",s.rcept_no]);continue;}
    if(!e.evidence.length)evidence.addRow([item.account,"근거 없음","review","","",null,"","","관련 주석을 찾지 못했습니다.",s.rcept_no]);
    for(const n of e.evidence) {
      for(const t of n.tables) {
        const confidence=t.amount_match&&t.direct_account_match?"verified":t.reconciliation?.matched?"reconciled":t.direct_account_match?"strong":"review";
        const id=addTable(item.account,n.note_number,n.note_title,t.rows,t.unit);
        evidence.addRow([item.account,n.evidence_type,confidence,n.note_number,n.note_title,t.matched_amount,t.unit,t.reconciliation?.matched?"일치":"",e.review_reason,s.rcept_no,id]);
        if(t.reconciliation)addReconciliation(item.account,n.note_number,n.note_title,t.reconciliation);
      }
      for(const p of n.paragraphs)evidence.addRow([item.account,"contextual_evidence","review",n.note_number,n.note_title,null,"","",p.text.slice(0,32767),s.rcept_no]);
    }
  }
  for(const item of f?.financial_data??[]) {
    const decision=d[getFinanceRowKey(item)]??{classification:null,memo:""},e=fe[getFinanceRowKey(item)];
    const enabled=item.ifrs18_status!=="합계"&&["금융수익","금융비용"].includes(item.category);
    const status=enabled?decisionStatus(decision):item.ifrs18_status==="합계"?"요약":"참고";
    if(enabled){total++;if(status==="완료"&&decision.classification)completed++;}
    const row=details.addRow([item.category,item.note_number,item.account,item.current_amount,item.prior_amount,f?.finance_note.unit,item.classification_driver,status,enabled?decision.classification:"",decision.memo,e?e.primary_confidence??"근거 없음":"미조회",s.rcept_no]);reviewControls(row,enabled);
    if(!e){if(enabled)evidence.addRow([item.account,"미조회","",item.note_number,f?.finance_note.note_title,null,f?.finance_note.unit,"","세부 근거 미조회",s.rcept_no]);continue;}
    for(const kind of ["amount_evidence","classification_evidence"] as const) {
      const n=e[kind];if(!n)continue;
      const id=addTable(item.account,n.note_number,n.note_title,n.table.rows,n.table.unit);
      evidence.addRow([item.account,kind,kind==="amount_evidence"?"verified":"strong",n.note_number,n.note_title,kind==="amount_evidence"?item.current_amount:null,n.table.unit,"",e.review_reason,s.rcept_no,id]);
    }
    const c=e.contextual_evidence;if(c)evidence.addRow([item.account,"contextual_evidence","review",c.note_number,c.note_title,null,"","",c.text.slice(0,32767),s.rcept_no]);
  }
  for(const row of [...s.excluded_oci_rows,...s.excluded_comprehensive_rows])oci.addRow([row.statement_scope,row.dart_order,row.account,row.current_amount===null?null:row.current_amount/1_000_000,row.prior_amount===null?null:row.prior_amount/1_000_000,row.display_unit,row.exclusion_reason,s.rcept_no]);
  summary.addRows([["회사",s.company],["고유번호",s.corp_code],["사업연도",s.year],["연결/별도",s.statement_type],["보고서",s.report.report_name],["접수번호",s.rcept_no],["접수일",s.report.rcept_date],["분석일",s.analyzed_at],["내보낸 시각",new Date().toISOString()],["금융 상세",f?"조회됨":"미조회: 세부계정 검토 및 완료율이 불완전합니다."],["검토 대상",total],["검토 완료",completed],["검토 완료율",total?completed/total:0],["회계 판단","Evidence confidence는 원문 대사 강도입니다. IFRS 18 최종 분류는 Reviewer가 결정합니다."],["원문",{text:"DART 사업보고서 열기",hyperlink:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${s.rcept_no}`}],...Object.entries(counts).map(([k,v])=>[`손익계정 근거 ${k}`,v])]);
  const completion=[`COUNTIFS('전체 손익계산서'!H2:H${Math.max(2,pl.rowCount)},"완료",'전체 손익계산서'!I2:I${Math.max(2,pl.rowCount)},"<>")`,`COUNTIFS('세부계정'!H2:H${Math.max(2,details.rowCount)},"완료",'세부계정'!I2:I${Math.max(2,details.rowCount)},"<>")`].join("+");
  summary.getCell("B13").value={formula:completion,result:completed};summary.getCell("B14").value={formula:"IF(B12=0,0,B13/B12)",result:total?completed/total:0};summary.getCell("B14").numFmt="0.0%";
  for(const ws of book.worksheets) {
    if(!["Summary","Evidence 표"].includes(ws.name))ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,ws.rowCount),column:ws.columnCount}};
    ws.eachRow((row,index)=>{if(index===1)return;let neededHeight=26;row.eachCell(cell=>{
      if (cell.value === "") cell.value = null;
      cell.font={name:"맑은 고딕",size:10,...cell.font};cell.alignment={vertical:"top",wrapText:true,...cell.alignment};
      if(typeof cell.value==="string") {
        cell.numFmt="@";
        if(!cell.isMerged) {
          const width=ws.getColumn(cell.col).width??20;
          const lineCount=cell.value.split("\n").reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/Math.max(8,width-2))),0);
          neededHeight=Math.max(neededHeight,lineCount*14+6);
        }
      }
      if(typeof cell.value==="number"||cell.type===ExcelJS.ValueType.Formula) {
        const value=typeof cell.value==="number"?cell.value:cell.result;
        cell.numFmt=cell.numFmt|| (typeof value==="number"&&!Number.isInteger(value)?'#,##0.00;[Red](#,##0.00);0':'#,##0;[Red](#,##0);0');
      }
    });if(!row.height)row.height=Math.min(409,neededHeight);});
  }
  return book;
}
