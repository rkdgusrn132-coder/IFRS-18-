export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({error:"개발용 진단 경로입니다."}, {status:404});
  const key = process.env.DART_API_KEY;

  if (!key) {
    return Response.json({
      error: "DART_API_KEY가 없습니다",
    });
  }

  const params = new URLSearchParams({
    crtfc_key: key,
    corp_code: "00126380",
    bgn_de: "20260101",
    end_de: "20260430",
    last_reprt_at: "Y",
    pblntf_ty: "A",
    pblntf_detail_ty: "A001",
    sort: "date",
    sort_mth: "desc",
    page_count: "10",
  });

  const url =
    `https://opendart.fss.or.kr/api/list.json?${params.toString()}`;

  const response = await fetch(url, {
    cache: "no-store",
  });

  const data = await response.json();

  if (data.status !== "000") {
    return Response.json(data);
  }

  const targetReport =
    data.list?.find((item: {report_nm?: string}) =>
      item.report_nm?.includes("2025.12")
    ) ?? null;

  return Response.json({
    company: "삼성전자",
    target_report: targetReport,
    reports: data.list,
  });
}