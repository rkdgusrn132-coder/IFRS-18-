import AdmZip from "adm-zip";

type TitleEntry = {
  text: string;
  startIndex: number;
};

type ExtractedTable = {
  table_index: number;
  rows: string[][];
};

function cleanText(value: string) {
  return value
    .replace(/<BR\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[＊*]/g, "")
    .trim();
}

function extractTableRows(tableXml: string) {
  const rows: string[][] = [];

  const rowRegex =
    /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;

  let rowMatch: RegExpExecArray | null;

  while (
    (rowMatch = rowRegex.exec(tableXml)) !== null
  ) {
    const rowXml = rowMatch[1];

    const cells: string[] = [];

    const cellRegex =
      /<(?:TD|TE|TH)\b[^>]*>([\s\S]*?)<\/(?:TD|TE|TH)>/gi;

    let cellMatch: RegExpExecArray | null;

    while (
      (cellMatch = cellRegex.exec(rowXml)) !== null
    ) {
      cells.push(
        cleanText(cellMatch[1])
      );
    }

    const meaningful =
      cells.some(
        (cell) =>
          cell.trim() !== ""
      );

    if (meaningful) {
      rows.push(cells);
    }
  }

  return rows;
}

function parseAmount(
  value: string
): number | null {
  let cleaned = value
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  if (
    cleaned === "" ||
    cleaned === "-" ||
    cleaned === "－"
  ) {
    return null;
  }

  /*
    (123) → -123
  */
  if (
    cleaned.startsWith("(") &&
    cleaned.endsWith(")")
  ) {
    cleaned = cleaned.slice(
      1,
      -1
    );

    const number =
      Number(cleaned);

    return Number.isNaN(number)
      ? null
      : -number;
  }

  /*
    △123 → -123
  */
  if (
    cleaned.startsWith("△")
  ) {
    cleaned =
      cleaned.replace(
        "△",
        ""
      );

    const number =
      Number(cleaned);

    return Number.isNaN(number)
      ? null
      : -number;
  }

  const number =
    Number(cleaned);

  return Number.isNaN(number)
    ? null
    : number;
}

function parsePercentage(
  value: string
): number | null {
  const cleaned = value
    .replace("%", "")
    .replace(/,/g, "")
    .trim();

  if (
    cleaned === "" ||
    cleaned === "-"
  ) {
    return null;
  }

  const number =
    Number(cleaned);

  return Number.isNaN(number)
    ? null
    : number;
}

function isMovementTable(
  table: ExtractedTable
) {
  const rowLabels =
    table.rows.map((row) =>
      normalizeLabel(
        row[0] ?? ""
      )
    );

  const hasBeginning =
    rowLabels.some(
      (label) =>
        label === "기초"
    );

  const hasAcquisition =
    rowLabels.some(
      (label) =>
        label === "취득"
    );

  const hasDisposal =
    rowLabels.some(
      (label) =>
        label === "처분"
    );

  const hasEnding =
    rowLabels.some(
      (label) =>
        label === "기말"
    );

  const hasEquityMethod =
    rowLabels.some(
      (label) =>
        label.includes(
          "지분법"
        )
    );

  /*
    다섯 조건 중 네 개 이상 맞으면
    투자변동표로 인정
  */

  const score = [
    hasBeginning,
    hasAcquisition,
    hasDisposal,
    hasEnding,
    hasEquityMethod,
  ].filter(Boolean).length;

  return score >= 4;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({error:"개발용 진단 경로입니다."}, {status:404});
  const dartApiKey =
    process.env.DART_API_KEY;

  if (!dartApiKey) {
    return Response.json({
      error:
        "DART_API_KEY가 없습니다",
    });
  }

  const rceptNo =
    "20260310002820";

  const dartUrl =
    `https://opendart.fss.or.kr/api/document.xml` +
    `?crtfc_key=${dartApiKey}` +
    `&rcept_no=${rceptNo}`;

  const response =
    await fetch(
      dartUrl,
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    return Response.json({
      error:
        "DART 원문 다운로드에 실패했습니다.",
      status:
        response.status,
    });
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(
      arrayBuffer
    );

  const zip =
    new AdmZip(buffer);

  const mainEntry =
    zip
      .getEntries()
      .filter(
        (entry) =>
          !entry.isDirectory
      )
      .sort(
        (a, b) =>
          b.header.size -
          a.header.size
      )[0];

  if (!mainEntry) {
    return Response.json({
      error:
        "사업보고서 XML을 찾지 못했습니다.",
    });
  }

  const xmlText =
    mainEntry
      .getData()
      .toString("utf8");

  /*
    TITLE 위치 추출
  */

  const titleRegex =
    /<TITLE\b[^>]*>([\s\S]*?)<\/TITLE>/gi;

  const titles: TitleEntry[] =
    [];

  let titleMatch:
    RegExpExecArray | null;

  while (
    (titleMatch =
      titleRegex.exec(
        xmlText
      )) !== null
  ) {
    const text =
      cleanText(
        titleMatch[1]
      );

    if (!text) {
      continue;
    }

    titles.push({
      text,
      startIndex:
        titleMatch.index,
    });
  }

  /*
    주석 9 시작점
  */

  const note9Index =
    titles.findIndex(
      (title) =>
        title.text ===
        "9. 관계기업 및 공동기업 투자 (연결)"
    );

  if (
    note9Index === -1
  ) {
    return Response.json({
      error:
        "연결 주석 9을 찾지 못했습니다.",
    });
  }

  /*
    주석 10 시작점
  */

  const note10Index =
    titles.findIndex(
      (
        title,
        index
      ) =>
        index >
          note9Index &&
        title.text ===
          "10. 유형자산 (연결)"
    );

  if (
    note10Index === -1
  ) {
    return Response.json({
      error:
        "연결 주석 10을 찾지 못했습니다.",
    });
  }

  /*
    주석 9만 추출
  */

  const note9Xml =
    xmlText.slice(
      titles[
        note9Index
      ].startIndex,

      titles[
        note10Index
      ].startIndex
    );

  /*
    주석 9 내부 표 추출
  */

  const tableRegex =
    /<TABLE\b[^>]*>([\s\S]*?)<\/TABLE>/gi;

  const tables:
    ExtractedTable[] = [];

  let tableMatch:
    RegExpExecArray | null;

  let tableIndex = 0;

  while (
    (tableMatch =
      tableRegex.exec(
        note9Xml
      )) !== null
  ) {
    const rows =
      extractTableRows(
        tableMatch[0]
      );

    if (
      rows.length === 0
    ) {
      continue;
    }

    tables.push({
      table_index:
        tableIndex,

      rows,
    });

    tableIndex++;
  }

  /*
    --------------------------------
    투자 변동표 탐색
    --------------------------------
  */

  const movementTable =
    tables.find(
      isMovementTable
    );

  const investmentMovement:
    {
      item: string;
      current_amount:
        number | null;
      prior_amount:
        number | null;
    }[] = [];

  if (movementTable) {
    for (
      const row of
      movementTable.rows
    ) {
      if (
        row.length < 3
      ) {
        continue;
      }

      const item =
        row[0]?.trim();

      if (!item) {
        continue;
      }

      const normalized =
        normalizeLabel(
          item
        );

      /*
        제목행 제외
      */

      if (
        normalized ===
          "구분" ||
        normalized ===
          "당기" ||
        normalized ===
          "전기"
      ) {
        continue;
      }

      const currentAmount =
        parseAmount(
          row[1] ?? ""
        );

      const priorAmount =
        parseAmount(
          row[2] ?? ""
        );

      /*
        금액이 둘 다 없는 행 제외
      */

      if (
        currentAmount ===
          null &&
        priorAmount ===
          null
      ) {
        continue;
      }

      investmentMovement.push({
        item,
        current_amount:
          currentAmount,
        prior_amount:
          priorAmount,
      });
    }
  }

  /*
    --------------------------------
    관계기업 / 공동기업 목록 탐색
    --------------------------------
  */

  const entityTable =
    tables.find(
      (table) =>
        table.rows.some(
          (row) => {
            const rowText =
              row.join(
                " "
              );

            return (
              rowText.includes(
                "기업명"
              ) &&
              rowText.includes(
                "지분율"
              )
            );
          }
        )
    );

  let entities:
    {
      company_name:
        string;

      relationship_nature:
        string | null;

      ownership_percentage:
        number | null;

      principal_place:
        string | null;

      fiscal_year_end:
        string | null;
    }[] = [];

  if (entityTable) {
    const headerIndex =
      entityTable.rows.findIndex(
        (row) => {
          const rowText =
            row.join(
              " "
            );

          return (
            rowText.includes(
              "기업명"
            ) &&
            rowText.includes(
              "지분율"
            )
          );
        }
      );

    if (
      headerIndex !== -1
    ) {
      entities =
        entityTable.rows
          .slice(
            headerIndex + 1
          )
          .filter(
            (row) =>
              row.length >= 3
          )
          .map(
            (row) => ({
              company_name:
                row[0] ??
                "",

              relationship_nature:
                row[1] ||
                null,

              ownership_percentage:
                parsePercentage(
                  row[2] ??
                    ""
                ),

              principal_place:
                row[3] ||
                null,

              fiscal_year_end:
                row[4] ||
                null,
            })
          )
          .filter(
            (entity) =>
              entity.company_name
                .trim() !== ""
          );
    }
  }

  /*
    지분법손익 행 찾기
  */

  const equityMethodProfit =
    investmentMovement.find(
      (row) =>
        normalizeLabel(
          row.item
        ).includes(
          "지분법"
        )
    );

  /*
    기초 / 기말도 별도 저장
  */

  const beginningBalance =
    investmentMovement.find(
      (row) =>
        normalizeLabel(
          row.item
        ) === "기초"
    );

  const endingBalance =
    investmentMovement.find(
      (row) =>
        normalizeLabel(
          row.item
        ) === "기말"
    );

  /*
    최종 결과
  */

  return Response.json({
    company:
      "삼성전자",

    year:
      "2025",

    statement_type:
      "연결",

    note_number:
      "9",

    note_title:
      "관계기업 및 공동기업 투자",

    unit:
      "백만원",

    source_tables: {
      investment_movement_table:
        movementTable
          ? movementTable.table_index
          : null,

      entity_table:
        entityTable
          ? entityTable.table_index
          : null,
    },

    investment_movement:
      investmentMovement,

    beginning_balance:
      beginningBalance ??
      null,

    ending_balance:
      endingBalance ??
      null,

    equity_method_profit: {
      account:
        "지분법이익",

      current_amount:
        equityMethodProfit
          ?.current_amount ??
        null,

      prior_amount:
        equityMethodProfit
          ?.prior_amount ??
        null,

      related_note:
        "주9",

      ifrs18_status:
        "검토 대상",

      provisional_category:
        null,
    },

    entities,
  });
}