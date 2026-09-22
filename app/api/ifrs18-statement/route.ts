import { apiError, getAnnualReport, reportLineage, validateScope, dartJson } from "@/lib/dart";
type DartAccount = {
  rcept_no?: string;
  reprt_code?: string;
  bsns_year?: string;
  corp_code?: string;
  corp_name?: string;

  sj_div?: string;
  sj_nm?: string;

  account_id?: string;
  account_nm?: string;
  account_detail?: string;

  thstrm_nm?: string;
  thstrm_amount?: string;

  frmtrm_nm?: string;
  frmtrm_amount?: string;

  bfefrmtrm_nm?: string;
  bfefrmtrm_amount?: string;

  ord?: string;
  currency?: string;
};

type CategoryHint =
  | "법인세"
  | "중단영업"
  | null;

type ValueType =
  | "monetary"
  | "per_share";

function normalizeText(
  value: string
) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function parseAmount(
  value:
    | string
    | null
    | undefined
): number | null {
  if (!value) {
    return null;
  }

  let cleaned = value
    .normalize("NFKC")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (
    cleaned === "" ||
    cleaned === "-" ||
    cleaned === "－"
  ) {
    return null;
  }

  let negative = false;

  if (
    cleaned.startsWith("(") &&
    cleaned.endsWith(")")
  ) {
    negative = true;
    cleaned =
      cleaned.slice(1, -1);
  }

  if (
    cleaned.startsWith("△")
  ) {
    negative = true;
    cleaned =
      cleaned.slice(1);
  }

  const number =
    Number(cleaned);

  if (
    Number.isNaN(number)
  ) {
    return null;
  }

  return negative
    ? -number
    : number;
}

/*
  DART 원래 계정명은 보존하면서
  화면에서 보여줄 이름만 정리한다.
*/

function getDisplayAccount(
  accountName: string
) {
  const normalized =
    normalizeText(
      accountName
    );

  if (
    normalized ===
      "금융수익세부계정" ||
    normalized ===
      "금융수익세부항목"
  ) {
    return "금융수익";
  }

  if (
    normalized ===
      "금융비용세부계정" ||
    normalized ===
      "금융비용세부항목"
  ) {
    return "금융비용";
  }

  return accountName;
}

/*
  금액인지 주당손익인지 구분한다.

  monetary:
    DART 원 단위 → 화면에서 백만원

  per_share:
    원/주 그대로 표시
*/

function getValueType(
  item: DartAccount
): ValueType {
  const account =
    normalizeText(
      item.account_nm ?? ""
    );

  const accountId =
    normalizeText(
      item.account_id ?? ""
    );

  if (
    account.includes(
      "주당"
    ) ||
    accountId.includes(
      "earningslosspershare"
    )
  ) {
    return "per_share";
  }

  return "monetary";
}

/*
  기타포괄손익 구성항목 판정
*/

function isOciAccount(
  item: DartAccount
) {
  const accountName =
    normalizeText(
      item.account_nm ?? ""
    );

  const accountId =
    normalizeText(
      item.account_id ?? ""
    );

  const nameSignals = [
    "기타포괄손익",
    "후속적으로",
    "재분류되지않",
    "재분류되는",
    "재측정요소",
    "해외사업장환산",
    "해외사업환산",
    "현금흐름위험회피",
    "기타포괄손익-공정가치",
  ];

  if (
    nameSignals.some(
      (signal) =>
        accountName.includes(
          normalizeText(
            signal
          )
        )
    )
  ) {
    return true;
  }

  const idSignals = [
    "othercomprehensiveincome",
    "remeasuringdefinedbenefitplans",
    "remeasurementsofdefinedbenefitplans",
    "cashflowhedges",
    "translationofforeignoperations",
    "shareofothercomprehensiveincome",
    "reclassificationadjustments",
  ];

  return idSignals.some(
    (signal) =>
      accountId.includes(
        signal
      )
  );
}

/*
  총포괄손익 및 총포괄손익 귀속정보는
  손익계산서 IFRS 18 분류표에서 분리한다.
*/

function isComprehensiveSummary(
  item: DartAccount
) {
  const account =
    normalizeText(
      item.account_nm ?? ""
    );

  const accountId =
    normalizeText(
      item.account_id ?? ""
    );

  if (
    accountId.includes(
      "totalcomprehensiveincome"
    )
  ) {
    return true;
  }

  if (
    accountId.includes(
      "comprehensiveincomeattributableto"
    )
  ) {
    return true;
  }

  if (
    account.includes(
      "총포괄이익"
    ) ||
    account.includes(
      "총포괄손실"
    ) ||
    account.includes(
      "총포괄손익"
    )
  ) {
    return true;
  }

  return false;
}

/*
  중간합계 / 귀속 / EPS
*/

function getNonClassificationType(
  accountName: string
) {
  const name =
    normalizeText(
      accountName
    );

  if (/주당/.test(name)) return "주당손익";
  if (/지배기업|비지배지분|귀속/.test(name)) return "귀속정보";
  if (name.includes("중단영업")) return null;
  const subtotalSignals = [
    "매출총이익",
    "매출총손실",

    "영업이익",
    "영업손실",
    "영업이익손실",

    "법인세비용차감전순이익",
    "법인세비용차감전순손실",
    "법인세비용차감전이익",
    "법인세비용차감전손실",

    "계속영업이익",
    "계속영업손실",

    "당기순이익",
    "당기순손실",

    "연결당기순이익",
    "연결당기순손실",
  ];

  if (
    subtotalSignals.some(
      (signal) =>
        name.includes(
          normalizeText(
            signal
          )
        )
    )
  ) {
    return "중간합계";
  }

  if (
    name.includes(
      "주당이익"
    ) ||
    name.includes(
      "주당손실"
    ) ||
    name.includes(
      "기본주당"
    ) ||
    name.includes(
      "희석주당"
    )
  ) {
    return "주당손익";
  }

  if (
    name.includes(
      "지배기업소유주"
    ) ||
    name.includes(
      "지배기업의소유주"
    ) ||
    name.includes(
      "비지배지분"
    )
  ) {
    return "귀속정보";
  }

  return null;
}

/*
  IFRS 18 검토영역
*/

function getReviewInfo(
  accountName: string
) {
  const name =
    normalizeText(
      accountName
    );

  if (
    name.includes(
      "법인세비용"
    ) ||
    name.includes(
      "법인세수익"
    )
  ) {
    return {
      review_area:
        "법인세",

      review_reason:
        "손익계산서에 인식된 법인세 관련 수익·비용인지 확인",

      next_action:
        "법인세 주석 확인",

      category_hint:
        "법인세" as CategoryHint,
    };
  }

  if (
    name.includes(
      "중단영업"
    )
  ) {
    return {
      review_area:
        "중단영업",

      review_reason:
        "중단영업에서 발생한 손익인지 확인",

      next_action:
        "중단영업 및 매각예정자산 관련 주석 확인",

      category_hint:
        "중단영업" as CategoryHint,
    };
  }

  if (
    name === "매출" ||
    name.includes(
      "매출액"
    ) ||
    name.includes(
      "영업수익"
    ) ||
    name.includes(
      "수익(매출액)"
    )
  ) {
    return {
      review_area:
        "영업수익 구조",

      review_reason:
        "기업의 주요 사업활동에서 발생한 수익의 구조 확인",

      next_action:
        "매출 및 영업부문 관련 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "매출원가"
    ) ||
    name.includes(
      "영업비용"
    )
  ) {
    return {
      review_area:
        "영업비용 구조",

      review_reason:
        "주요 영업활동에 관련된 비용의 성격 확인",

      next_action:
        "매출원가 및 비용 성격 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "판매비"
    ) ||
    name.includes(
      "관리비"
    )
  ) {
    return {
      review_area:
        "판매관리비",

      review_reason:
        "영업활동 관련 비용의 성격과 기능 확인",

      next_action:
        "판매비와관리비 세부 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "기타수익"
    ) ||
    name.includes(
      "기타이익"
    ) ||
    name.includes(
      "영업외수익"
    ) ||
    name.includes(
      "영업외이익"
    )
  ) {
    return {
      review_area:
        "기타수익",

      review_reason:
        "수익의 발생 원천과 관련 자산·거래의 성격 확인",

      next_action:
        "기타수익·영업외수익 세부 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "기타비용"
    ) ||
    name.includes(
      "기타손실"
    ) ||
    name.includes(
      "영업외비용"
    ) ||
    name.includes(
      "영업외손실"
    )
  ) {
    return {
      review_area:
        "기타비용",

      review_reason:
        "비용의 발생 원천과 관련 자산·거래의 성격 확인",

      next_action:
        "기타비용·영업외비용 세부 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "금융수익"
    ) ||
    name.includes(
      "금융이익"
    ) ||
    name.includes(
      "이자수익"
    ) ||
    name.includes(
      "배당수익"
    ) ||
    name.includes(
      "배당금수익"
    )
  ) {
    return {
      review_area:
        "금융수익",

      review_reason:
        "금융수익을 발생시킨 자산과 기업의 주요 사업활동 간 관계 확인",

      next_action:
        "금융상품 및 관련 자산 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "금융비용"
    ) ||
    name.includes(
      "금융원가"
    ) ||
    name.includes(
      "이자비용"
    ) ||
    name.includes(
      "순금융원가"
    )
  ) {
    return {
      review_area:
        "금융비용",

      review_reason:
        "금융비용을 발생시킨 부채와 자금조달 구조 확인",

      next_action:
        "차입금·사채·금융부채 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "지분법"
    ) ||
    name.includes(
      "관계기업"
    ) ||
    name.includes(
      "공동기업"
    )
  ) {
    return {
      review_area:
        "관계기업·공동기업",

      review_reason:
        "관계기업 또는 공동기업 투자에서 발생한 손익 확인",

      next_action:
        "관계기업 및 공동기업 투자 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "외환"
    ) ||
    name.includes(
      "외화"
    ) ||
    name.includes(
      "환율"
    )
  ) {
    return {
      review_area:
        "외환손익",

      review_reason:
        "외환손익이 발생한 기초 자산·부채의 성격 확인",

      next_action:
        "외화표시 자산·부채 및 재무위험관리 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "파생상품"
    )
  ) {
    return {
      review_area:
        "파생상품",

      review_reason:
        "파생상품이 관리하는 위험과 기초항목 확인",

      next_action:
        "파생상품 및 위험관리 주석 확인",

      category_hint:
        null,
    };
  }

  if (
    name.includes(
      "처분이익"
    ) ||
    name.includes(
      "처분손실"
    ) ||
    name.includes(
      "평가이익"
    ) ||
    name.includes(
      "평가손실"
    ) ||
    name.includes(
      "손상차손"
    ) ||
    name.includes(
      "손상차손환입"
    )
  ) {
    return {
      review_area:
        "자산 관련 손익",

      review_reason:
        "손익을 발생시킨 기초 자산의 종류와 사용 목적 확인",

      next_action:
        "관련 자산 및 손익 세부 주석 확인",

      category_hint:
        null,
    };
  }

  return {
    review_area:
      "개별 검토",

    review_reason:
      "계정명만으로 IFRS 18 분류 근거를 충분히 판단하기 어려움",

    next_action:
      "관련 주석 및 거래 성격 확인",

    category_hint:
      null,
  };
}

/*
  사람이 보기 위한 표시순서
*/

function getPresentationOrder(
  accountName: string
) {
  const name =
    normalizeText(
      accountName
    );

  if (/주당/.test(name)) return /희석/.test(name) ? 1710 : 1700;
  if (/비지배지분/.test(name)) return 1610;
  if (/지배기업|귀속/.test(name)) return 1600;
  if (
    name === "매출" ||
    name.includes(
      "매출액"
    ) ||
    name.includes(
      "영업수익"
    ) ||
    name.includes(
      "수익(매출액)"
    )
  ) {
    return 100;
  }

  if (
    name.includes(
      "매출원가"
    )
  ) {
    return 200;
  }

  if (
    name.includes(
      "매출총이익"
    ) ||
    name.includes(
      "매출총손실"
    )
  ) {
    return 300;
  }

  if (
    name.includes(
      "판매비"
    ) ||
    name.includes(
      "관리비"
    )
  ) {
    return 400;
  }

  if (
    name.includes(
      "연구개발"
    )
  ) {
    return 420;
  }

  if (
    name.includes(
      "영업비용"
    )
  ) {
    return 440;
  }

  if (
    name.includes(
      "영업이익"
    ) ||
    name.includes(
      "영업손실"
    )
  ) {
    return 500;
  }

  if (
    name.includes(
      "기타수익"
    ) ||
    name.includes(
      "기타이익"
    ) ||
    name.includes(
      "영업외수익"
    ) ||
    name.includes(
      "영업외이익"
    )
  ) {
    return 600;
  }

  if (
    name.includes(
      "기타비용"
    ) ||
    name.includes(
      "기타손실"
    ) ||
    name.includes(
      "영업외비용"
    ) ||
    name.includes(
      "영업외손실"
    )
  ) {
    return 700;
  }

  if (
    name.includes(
      "금융수익"
    ) ||
    name.includes(
      "금융이익"
    ) ||
    name.includes(
      "이자수익"
    ) ||
    name.includes(
      "배당수익"
    )
  ) {
    return 800;
  }

  if (
    name.includes(
      "금융비용"
    ) ||
    name.includes(
      "금융원가"
    ) ||
    name.includes(
      "이자비용"
    )
  ) {
    return 900;
  }

  if (
    name.includes(
      "지분법"
    ) ||
    name.includes(
      "관계기업"
    ) ||
    name.includes(
      "공동기업"
    )
  ) {
    return 1000;
  }

  if (
    name.includes(
      "법인세비용차감전"
    ) ||
    name.includes(
      "법인세차감전"
    )
  ) {
    return 1100;
  }

  if (
    name.includes(
      "법인세비용"
    ) ||
    name.includes(
      "법인세수익"
    )
  ) {
    return 1200;
  }

  if (
    name.includes(
      "계속영업"
    )
  ) {
    return 1300;
  }

  if (
    name.includes(
      "중단영업"
    )
  ) {
    return 1400;
  }

  if (
    name.includes(
      "당기순이익"
    ) ||
    name.includes(
      "당기순손실"
    )
  ) {
    return 1500;
  }

  if (
    name.includes(
      "지배기업"
    )
  ) {
    return 1600;
  }

  if (
    name.includes(
      "비지배지분"
    )
  ) {
    return 1610;
  }

  if (
    name.includes(
      "기본주당"
    )
  ) {
    return 1700;
  }

  if (
    name.includes(
      "희석주당"
    )
  ) {
    return 1710;
  }

  if (
    name.includes(
      "주당이익"
    ) ||
    name.includes(
      "주당손실"
    )
  ) {
    return 1720;
  }

  return 750;
}

function removeDuplicates(
  rows: DartAccount[]
) {
  const seen =
    new Set<string>();

  return rows.filter(
    (item) => {
      const key =
        [
          normalizeText(
            item.account_nm ??
              ""
          ),

          item.account_detail ??
            "",

          item.thstrm_amount ??
            "",

          item.frmtrm_amount ??
            "",
        ].join("::");

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

export async function GET(
  request: Request
) {
 try {
  const dartApiKey =
    process.env.DART_API_KEY;

  if (!dartApiKey) {
    return Response.json(
      {
        error:
          "DART_API_KEY가 없습니다.",
      },
      {
        status: 500,
      }
    );
  }

  const url =
    new URL(request.url);

  const corpCode =
    url.searchParams.get(
      "corp_code"
    );

  const corpName =
    url.searchParams.get(
      "corp_name"
    ) ?? "";

  const year =
    url.searchParams.get(
      "year"
    ) ?? "2025";

  const fsDiv =
    url.searchParams.get(
      "fs_div"
    ) ?? "CFS";

  if (!corpCode) {
    return Response.json(
      {
        error:
          "corp_code가 필요합니다.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    fsDiv !== "CFS" &&
    fsDiv !== "OFS"
  ) {
    return Response.json(
      {
        error:
          "fs_div는 CFS 또는 OFS여야 합니다.",
      },
      {
        status: 400,
      }
    );
  }

  validateScope(corpCode, year, fsDiv);
  const params =
    new URLSearchParams({
      crtfc_key:
        dartApiKey,

      corp_code:
        corpCode,

      bsns_year:
        year,

      reprt_code:
        "11011",

      fs_div:
        fsDiv,
    });

  const data = await dartJson<{ list: DartAccount[] }>("fnlttSinglAcntAll.json", Object.fromEntries(params));
  const allRows:
    DartAccount[] =
    data.list ?? [];

  /*
    별도 IS가 존재하면 IS 사용.
    그렇지 않으면 CIS 사용.
  */

  const isRows =
    allRows.filter(
      (item) =>
        item.sj_div ===
        "IS"
    );

  const cisRows =
    allRows.filter(
      (item) =>
        item.sj_div ===
        "CIS"
    );

  const sourceStatement =
    isRows.length > 0
      ? "IS"
      : "CIS";

  const selectedRows = sourceStatement === "IS" ? [...isRows, ...cisRows.filter(item => isOciAccount(item) || isComprehensiveSummary(item))] : cisRows;
  if (!selectedRows.length) return Response.json({error: "해당 조건의 손익계산서가 없습니다."}, {status: 404});
  const receipt = selectedRows[0].rcept_no;
  if (!receipt || selectedRows.some(item => item.rcept_no !== receipt)) return Response.json({error: "재무제표 접수번호를 확인할 수 없습니다."}, {status: 409});
  const report = await getAnnualReport(corpCode, year, receipt);

  const uniqueRows =
    removeDuplicates(
      selectedRows
    );

  /*
    세 그룹으로 분리

    1. 손익계산서
    2. OCI 구성항목
    3. 총포괄손익 표시항목
  */

  const ociRows =
    uniqueRows.filter(
      (item) =>
        isOciAccount(
          item
        )
    );

  const comprehensiveSummaryRows =
    uniqueRows.filter(
      (item) =>
        !isOciAccount(
          item
        ) &&
        isComprehensiveSummary(
          item
        )
    );

  const profitOrLossRows =
    uniqueRows.filter(
      (item) =>
        !isOciAccount(
          item
        ) &&
        !isComprehensiveSummary(
          item
        )
    );

  const mappedRows =
    profitOrLossRows.map(
      (
        item
      ) => {
        const account =
          item.account_nm ??
          "";

        const displayAccount =
          getDisplayAccount(
            account
          );

        const valueType =
          getValueType(
            item
          );

        const nonClassificationType =
          getNonClassificationType(
            account
          );

        const reviewInfo =
          getReviewInfo(
            account
          );

        return {
          source_index:
            allRows.indexOf(item) + 1,

          presentation_order:
            getPresentationOrder(
              account
            ),

          dart_order:
            item.ord ??
            null,

          source_statement:
            item.sj_div ?? sourceStatement,
          rcept_no: receipt,
          current_amount_raw: item.thstrm_amount ?? null,
          prior_amount_raw: item.frmtrm_amount ?? null,
          review_status: "미검토",

          statement_scope:
            "profit_or_loss",

          account_id:
            item.account_id ??
            null,

          /*
            DART 원문 계정명
          */
          account,

          /*
            화면 표시용 계정명
          */
          display_account:
            displayAccount,

          account_detail:
            item.account_detail ??
            null,

          current_amount:
            parseAmount(
              item.thstrm_amount
            ),

          prior_amount:
            parseAmount(
              item.frmtrm_amount
            ),

          before_prior_amount:
            parseAmount(
              item.bfefrmtrm_amount
            ),

          currency:
            item.currency ??
            "KRW",

          value_type:
            valueType,

          display_unit:
            valueType ===
            "per_share"
              ? "원/주"
              : "백만원",

          non_classification_type:
            nonClassificationType,

          ifrs18_status:
            nonClassificationType
              ? "요약"
              : "검토 필요",

          review_area:
            nonClassificationType
              ? nonClassificationType
              : reviewInfo.review_area,

          review_reason:
            nonClassificationType
              ? "중간합계·주당손익 또는 귀속정보로 개별 수익·비용 분류 대상이 아님"
              : reviewInfo.review_reason,

          next_action:
            nonClassificationType
              ? null
              : reviewInfo.next_action,

          category_hint:
            nonClassificationType
              ? null
              : reviewInfo.category_hint,

          provisional_category:
            null,
        };
      }
    );

  const statementRows =
    mappedRows
      .sort(
        (a, b) => {
          if (
            a.presentation_order !==
            b.presentation_order
          ) {
            return (
              a.presentation_order -
              b.presentation_order
            );
          }

          return (
            a.source_index -
            b.source_index
          );
        }
      )
      .map(
        (
          row,
          index
        ) => ({
          ...row,

          display_order:
            index + 1,
        })
      );

  const excludedOciRows =
    ociRows.map(
      (
        item,
        index
      ) => ({
        display_order:
          index + 1,

        exclusion_type:
          "OCI 구성항목",

        dart_order:
          item.ord ??
          null,

        account_id:
          item.account_id ??
          null,

        account:
          item.account_nm ??
          "",

        current_amount:
          parseAmount(
            item.thstrm_amount
          ),

        prior_amount:
          parseAmount(
            item.frmtrm_amount
          ),

        currency:
          item.currency ??
          "KRW",

        value_type:
          "monetary",

        display_unit:
          "백만원",

        statement_scope:
          "oci",

        ifrs18_status:
          "범위외",

        exclusion_reason:
          "기타포괄손익 구성항목으로 손익계산서 IFRS 18 범주 검토와 분리",
      })
    );

  const excludedComprehensiveRows =
    comprehensiveSummaryRows.map(
      (
        item,
        index
      ) => ({
        display_order:
          index + 1,

        exclusion_type:
          "포괄손익 표시항목",

        dart_order:
          item.ord ??
          null,

        account_id:
          item.account_id ??
          null,

        account:
          item.account_nm ??
          "",

        current_amount:
          parseAmount(
            item.thstrm_amount
          ),

        prior_amount:
          parseAmount(
            item.frmtrm_amount
          ),

        currency:
          item.currency ??
          "KRW",

        value_type:
          "monetary",

        display_unit:
          "백만원",

        statement_scope:
          "comprehensive_summary",

        ifrs18_status:
          "범위외",

        exclusion_reason:
          "총포괄손익 또는 총포괄손익 귀속 표시항목으로 손익계산서 개별 수익·비용 분류 대상과 분리",
      })
    );

  const reviewCandidates =
    statementRows.filter(
      (row) =>
        row.ifrs18_status ===
        "검토 필요"
    );

  const summaryRows =
    statementRows.filter(
      (row) =>
        row.ifrs18_status ===
        "요약"
    );

  const hintedRows =
    reviewCandidates.filter(
      (row) =>
        row.category_hint !==
        null
    );

  const detectedCompany =
    allRows[0]
      ?.corp_name ??
    corpName ??
    corpCode;

  return Response.json({
    report: reportLineage(report),
    rcept_no: receipt,
    analyzed_at: new Date().toISOString(),
    company: detectedCompany || report.corp_name || corpCode,

    corp_code:
      corpCode,

    year,

    statement_type:
      fsDiv === "CFS"
        ? "연결"
        : "별도",

    fs_div:
      fsDiv,

    source_statement:
      sourceStatement,

    source_statement_name:
      sourceStatement === "IS"
        ? "손익계산서"
        : "포괄손익계산서",

    source_amount_unit:
      "원",

    normal_display_unit:
      "백만원",

    per_share_display_unit:
      "원/주",

    category_options: [
      "영업",
      "투자",
      "재무",
      "법인세",
      "중단영업",
      "추가검토",
    ],

    ordering_method:
      "presentation_heuristic_v2",

    counts: {
      source_rows:
        uniqueRows.length,

      profit_or_loss_rows:
        statementRows.length,

      review_candidates:
        reviewCandidates.length,

      summary_rows:
        summaryRows.length,

      category_hints:
        hintedRows.length,

      excluded_oci_rows:
        excludedOciRows.length,

      excluded_comprehensive_rows:
        excludedComprehensiveRows.length,

      total_excluded_rows:
        excludedOciRows.length +
        excludedComprehensiveRows.length,
    },

    statement_rows:
      statementRows,

    excluded_oci_rows:
      excludedOciRows,

    excluded_comprehensive_rows:
      excludedComprehensiveRows,
  });
  } catch (error) { return apiError(error); }
}
