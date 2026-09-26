import { cached, dartZipXml, apiError, DartError } from "@/lib/dart";
import { XMLParser } from "fast-xml-parser";

type DartCompany = {
  corp_code?: string;
  corp_name?: string;
  corp_eng_name?: string;
  stock_code?: string;
  modify_date?: string;
};

export async function GET(request: Request) {
  const dartApiKey = process.env.DART_API_KEY;

  if (!dartApiKey) {
    return Response.json(
      {
        error: "DART_API_KEY가 없습니다.",
      },
      {
        status: 500,
      }
    );
  }

  const requestUrl = new URL(request.url);

  const query =
    requestUrl.searchParams
      .get("q")
      ?.trim() ?? "";

  if (!query) {
    return Response.json({
      query: "",
      results: [],
    });
  }

  try {
    const companies = await cached("company-registry", async () => {
    const xmlText = await dartZipXml("corpCode.xml", {}, "CORPCODE.xml");

    const parser =
      new XMLParser({
        ignoreAttributes: false,

        /*
          00126380 같은 고유번호의
          앞자리 0이 사라지지 않도록
          문자열로 유지한다.
        */
        parseTagValue: false,

        trimValues: true,
      });

    const parsed =
      parser.parse(xmlText);

    const rawList =
      parsed?.result?.list ??
      parsed?.list ??
      [];

    const companies: DartCompany[] =
      Array.isArray(rawList)
        ? rawList
        : [rawList];

    if (!companies.length || !companies.every(company => typeof company?.corp_code === "string" && typeof company.corp_name === "string")) {
      throw new DartError("DART 회사 목록의 형식을 확인할 수 없습니다. 잠시 후 다시 시도하세요.");
    }
    return companies;
    }, 24 * 60 * 60_000);
    /*
      4. 회사명 / 종목코드 검색
    */

    const normalizedQuery =
      query
        .replace(/\s+/g, "")
        .toLowerCase();

    const matched =
      companies.filter(
        (company) => {
          const corpName =
            String(
              company.corp_name ?? ""
            )
              .replace(/\s+/g, "")
              .toLowerCase();

          const stockCode =
            String(
              company.stock_code ?? ""
            )
              .replace(/\s+/g, "")
              .toLowerCase();

          return (
            corpName.includes(
              normalizedQuery
            ) ||
            stockCode.includes(
              normalizedQuery
            )
          );
        }
      );

    /*
      5. 정확한 회사명 → 앞부분 일치 → 기타
         순서로 정렬
    */

    matched.sort((a, b) => {
      const aName =
        String(
          a.corp_name ?? ""
        )
          .replace(/\s+/g, "")
          .toLowerCase();

      const bName =
        String(
          b.corp_name ?? ""
        )
          .replace(/\s+/g, "")
          .toLowerCase();

      const aExact =
        aName ===
        normalizedQuery;

      const bExact =
        bName ===
        normalizedQuery;

      if (
        aExact &&
        !bExact
      ) {
        return -1;
      }

      if (
        !aExact &&
        bExact
      ) {
        return 1;
      }

      const aStarts =
        aName.startsWith(
          normalizedQuery
        );

      const bStarts =
        bName.startsWith(
          normalizedQuery
        );

      if (
        aStarts &&
        !bStarts
      ) {
        return -1;
      }

      if (
        !aStarts &&
        bStarts
      ) {
        return 1;
      }

      return aName.localeCompare(
        bName,
        "ko"
      );
    });

    /*
      검색 결과 최대 20개
    */

    const results =
      matched
        .slice(0, 20)
        .map(
          (company) => ({
            corp_code:
              company.corp_code ?? "",

            corp_name:
              company.corp_name ?? "",

            stock_code:
              company.stock_code ?? "",

            corp_eng_name:
              company.corp_eng_name ?? "",
          })
        );

    return Response.json({
      query,
      count: results.length,
      results,
    });
  } catch (error) { return apiError(error); }
}
