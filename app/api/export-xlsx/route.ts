import { POST as legacyExport } from '@/lib/legacy-export';
import { buildWorkbook, type ExportRequest } from '@/lib/workbook';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get('content-length')) > 15000000) return Response.json({error:'내보낼 근거 데이터가 너무 큽니다.'},{status:413});
    const body = await request.clone().json();
    if (!body.statement && body.analysis) return legacyExport(request);
    const data = body as ExportRequest;
    const s = data.statement;
    if (!s?.report?.rcept_no || !Array.isArray(s.statement_rows) || s.statement_rows.length > 5000) return Response.json({error:'내보낼 손익계산서와 접수번호를 확인해주세요.'},{status:400});
    if ((data.financeAnalysis && data.financeAnalysis.report.rcept_no !== s.report.rcept_no) || [...Object.values(data.statementEvidenceCache ?? {}),...Object.values(data.financeEvidenceCache ?? {})].some(e=>e.report.rcept_no !== s.report.rcept_no)) return Response.json({error:'서로 다른 접수번호의 자료를 함께 내보낼 수 없습니다.'},{status:409});
    const book = await buildWorkbook(data);
    const buffer = await book.xlsx.writeBuffer();
    const name = ['IFRS18',s.company,s.year,s.fs_div,s.rcept_no].join('_').replace(/[\\/:*?"<>|]/g,'_')+'.xlsx';
    return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)}});
  } catch { return Response.json({error:'Excel 생성에 실패했습니다. 분석을 다시 실행한 뒤 내보내세요.'},{status:500}); }
}