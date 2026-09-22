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
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
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
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .replace(/[＊*]/g, "")
    .trim();
}

function parseAmount(
  value: string | null | undefined
): number | null {
  if (!value) {
    return null;
  }

  const cleaned = value
    .normalize("NFKC")
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

  if (
    cleaned.startsWith("(") &&
    cleaned.endsWith(")")
  ) {
    const number = Number(
      cleaned.slice(1, -1)
    );

    return Number.isNaN(number)
      ? null
      : -number;
  }

  if (cleaned.startsWith("△")) {
    const number = Number(
      cleaned.replace("△", "")
    );

    return Number.isNaN(number)
      ? null
      : -number;
  }

  const number = Number(cleaned);

  return Number.isNaN(number)
    ? null
    : number;
}

function toMillionWon(
  amount: number | null
) {
  if (amount === null) {
    return null;
  }

  return amount / 1_000_000;
}

function extractTableRows(
  tableXml: string
) {
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

    if (
      cells.some(
        (cell) =>
          cell.trim() !== ""
      )
    ) {
      rows.push(cells);
    }
  }

  return rows;
}

function isMovementTable(
  table: ExtractedTable
) {
  const labels =
    table.rows.map((row) =>
      normalizeLabel(
        row[0] ?? ""
      )
    );

  const tests = [
    labels.some(
      (label) =>
        label === "기초"
    ),

    labels.some(
      (label) =>
        label === "취득"
    ),

    labels.some(
      (label) =>
        label === "처분"
    ),

    labels.some(
      (label) =>
        label === "기말"
    ),

    labels.some(
      (label) =>
        label.includes("지분")
    ),
  ];

  return (
    tests.filter(Boolean).length >= 4
  );
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({error:"개발용 진단 경로입니다."}, {status:404});
  const dartApiKey =
    process.env.DART_API_KEY;

  if (!dartApiKey) {
    return Response.json({
      error: "DART_API_KEY가 없습니다",
    });
  }

  const corpCode = "00126380";
  const bsnsYear = "2025";
  const reprtCode = "11011";
  const fsDiv = "CFS";
  const rceptNo = "20260310002820";

  /*
    ====================================
    1. 연결손익계산서에서 지분법이익 조회
    ====================================
  */

  const fsParams =
    new URLSearchParams({
      crtfc_key: dartApiKey,
      corp_code: corpCode,
      bsns_year: bsnsYear,
      reprt_code: reprtCode,
      fs_div: fsDiv,
    });

  const fsUrl =
    `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${fsParams.toString()}`;

  const fsResponse =
    await fetch(fsUrl, {
      cache: "no-store",
    });

  const fsData =
    await fsResponse.json();

  if (fsData.status !== "000") {
    return Response.json({
      error:
        "재무제표 조회에 실패했습니다.",
      dart_response: fsData,
    });
  }

  const equityMethodAccount =
    fsData.list.find(
      (item: {sj_div: string; account_nm?: string}) =>
        (
          item.sj_div === "IS" ||
          item.sj_div === "CIS"
        ) &&
        item.account_nm
          ?.replace(/\s+/g, "")
          .includes("지분법이익")
    );

  if (!equityMethodAccount) {
    return Response.json({
      error:
        "손익계산서에서 지분법이익을 찾지 못했습니다.",
    });
  }

  /*
    DART 재무제표 API 금액은 원 단위.
  */

  const statementCurrentRaw =
    parseAmount(
      equityMethodAccount.thstrm_amount
    );

  const statementPriorRaw =
    parseAmount(
      equityMethodAccount.frmtrm_amount
    );

  /*
    주석이 백만원 단위이므로
    백만원으로 변환.
  */

  const statementCurrent =
    toMillionWon(
      statementCurrentRaw
    );

  const statementPrior =
    toMillionWon(
      statementPriorRaw
    );

  /*
    ====================================
    2. 사업보고서 원문 다운로드
    ====================================
  */

  const documentUrl =
    `https://opendart.fss.or.kr/api/document.xml` +
    `?crtfc_key=${dartApiKey}` +
    `&rcept_no=${rceptNo}`;

  const documentResponse =
    await fetch(documentUrl, {
      cache: "no-store",
    });

  if (!documentResponse.ok) {
    return Response.json({
      error:
        "사업보고서 원문 다운로드에 실패했습니다.",
      status:
        documentResponse.status,
    });
  }

  const arrayBuffer =
    await documentResponse.arrayBuffer();

  const zip =
    new AdmZip(
      Buffer.from(arrayBuffer)
    );

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
    ====================================
    3. 주석 9 추출
    ====================================
  */

  const titleRegex =
    /<TITLE\b[^>]*>([\s\S]*?)<\/TITLE>/gi;

  const titles: TitleEntry[] = [];

  let titleMatch:
    RegExpExecArray | null;

  while (
    (titleMatch =
      titleRegex.exec(xmlText)) !== null
  ) {
    const text =
      cleanText(titleMatch[1]);

    if (!text) {
      continue;
    }

    titles.push({
      text,
      startIndex:
        titleMatch.index,
    });
  }

  const note9Index =
    titles.findIndex(
      (title) =>
        title.text ===
        "9. 관계기업 및 공동기업 투자 (연결)"
    );

  const note10Index =
    titles.findIndex(
      (title, index) =>
        index > note9Index &&
        title.text ===
          "10. 유형자산 (연결)"
    );

  if (
    note9Index === -1 ||
    note10Index === -1
  ) {
    return Response.json({
      error:
        "주석 9 또는 주석 10을 찾지 못했습니다.",
    });
  }

  const note9Xml =
    xmlText.slice(
      titles[note9Index].startIndex,
      titles[note10Index].startIndex
    );

  /*
    ====================================
    4. 주석 9의 표 추출
    ====================================
  */

  const tableRegex =
    /<TABLE\b[^>]*>([\s\S]*?)<\/TABLE>/gi;

  const tables: ExtractedTable[] = [];

  let tableMatch:
    RegExpExecArray | null;

  let tableIndex = 0;

  while (
    (tableMatch =
      tableRegex.exec(note9Xml)) !== null
  ) {
    const rows =
      extractTableRows(
        tableMatch[0]
      );

    if (rows.length === 0) {
      continue;
    }

    tables.push({
      table_index:
        tableIndex,
      rows,
    });

    tableIndex++;
  }

  const movementTable =
    tables.find(
      isMovementTable
    );

  if (!movementTable) {
    return Response.json({
      error:
        "관계기업 투자 변동표를 찾지 못했습니다.",
    });
  }

  /*
    ====================================
    5. 지분법 관련 행 검색

    실제 삼성전자 주석에는
    "이익 중 지분해당액"이라고 표시됨.
    ====================================
  */

  const equityMethodRow =
    movementTable.rows.find(
      (row) => {
        const label =
          normalizeLabel(
            row[0] ?? ""
          );

        return (
          label.includes("지분법") ||
          (
            label.includes("지분") &&
            label.includes("해당액")
          )
        );
      }
    );

  if (!equityMethodRow) {
    return Response.json({
      error:
        "주석 9에서 지분법 관련 행을 찾지 못했습니다.",
      movement_rows:
        movementTable.rows,
    });
  }

  const noteCurrent =
    parseAmount(
      equityMethodRow[1]
    );

  const notePrior =
    parseAmount(
      equityMethodRow[2]
    );

  /*
    ====================================
    6. 손익계산서 ↔ 주석 자동 대사
    ====================================
  */

  const currentDifference =
    statementCurrent !== null &&
    noteCurrent !== null
      ? statementCurrent -
        noteCurrent
      : null;

  const priorDifference =
    statementPrior !== null &&
    notePrior !== null
      ? statementPrior -
        notePrior
      : null;

  /*
    주석이 백만원 단위 반올림일 수 있으므로
    1백만원 이하 차이는 일치로 처리.
  */

  const tolerance = 1;

  const currentMatched =
    currentDifference !== null
      ? Math.abs(
          currentDifference
        ) <= tolerance
      : false;

  const priorMatched =
    priorDifference !== null
      ? Math.abs(
          priorDifference
        ) <= tolerance
      : false;

  const overallMatched =
    currentMatched &&
    priorMatched;

  /*
    ====================================
    7. 결과
    ====================================
  */

  return Response.json({
    company:
      "삼성전자",

    year:
      "2025",

    statement_type:
      "연결",

    unit:
      "백만원",

    reconciliation: {
      account:
        "지분법이익",

      statement: {
        source:
          "연결손익계산서",

        original_unit:
          "원",

        current_amount_raw:
          statementCurrentRaw,

        prior_amount_raw:
          statementPriorRaw,

        current_amount:
          statementCurrent,

        prior_amount:
          statementPrior,
      },

      note: {
        note_number:
          "9",

        note_title:
          "관계기업 및 공동기업 투자",

        source_row:
          equityMethodRow[0],

        current_amount:
          noteCurrent,

        prior_amount:
          notePrior,
      },

      current_difference:
        currentDifference,

      prior_difference:
        priorDifference,

      current_matched:
        currentMatched,

      prior_matched:
        priorMatched,

      overall_matched:
        overallMatched,
    },

    ifrs18_review: {
      account:
        "지분법이익",

      related_note:
        "주9",

      data_verified:
        overallMatched,

      provisional_category:
        null,

      status:
        overallMatched
          ? "원천 데이터 대사 완료"
          : "차이 검토 필요",
    },
  });
}