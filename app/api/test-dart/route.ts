export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({error:"개발용 진단 경로입니다."}, {status:404});
  const key = process.env.DART_API_KEY;

  if (!key) {
    return Response.json({
      error: "DART_API_KEY가 없습니다",
    });
  }

  const corpCode = "00126380";
  const bsnsYear = "2025";
  const reprtCode = "11011";
  const fsDiv = "CFS";

  const url =
    `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json` +
    `?crtfc_key=${key}` +
    `&corp_code=${corpCode}` +
    `&bsns_year=${bsnsYear}` +
    `&reprt_code=${reprtCode}` +
    `&fs_div=${fsDiv}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "000") {
    return Response.json(data);
  }

  const reviewKeywords = [
    "이자",
    "금융",
    "배당",
    "투자",
    "관계기업",
    "공동기업",
    "지분법",
    "외환",
    "파생",
  ];

  const incomeStatement = data.list
    .filter(
      (item: { sj_div: string; account_nm: string; thstrm_amount: string; frmtrm_amount: string; currency: string }) =>
        item.sj_div === "IS" || item.sj_div === "CIS"
    )
    .map((item: { sj_div: string; account_nm: string; thstrm_amount: string; frmtrm_amount: string; currency: string }) => {
      const matchedKeywords = reviewKeywords.filter((keyword) =>
        item.account_nm.includes(keyword)
      );

      return {
        account_nm: item.account_nm,
        thstrm_amount: item.thstrm_amount,
        frmtrm_amount: item.frmtrm_amount,
        currency: item.currency,

        review_required: matchedKeywords.length > 0,
        matched_keywords: matchedKeywords,
      };
    });

  return Response.json({
    company: "삼성전자",
    year: bsnsYear,
    financial_statement: "연결재무제표",
    accounts: incomeStatement,
  });
}