import { apiError, cached, getAnnualReport, getDocumentXml, validateScope } from "@/lib/dart";

type TitleEntry = {
  text: string;
  startIndex: number;
};

type ParsedRow = {
  category: string;
  account: string;
  amount: number;
};

type RawParsedRow = {
  category: string | null;
  account: string;
  amount: number;
};

type ExtractedTable = {
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

function toReadableText(xml: string) {
  return xml
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/<BR\s*\/?>/gi, "\n")
    .replace(/<\/P>/gi, "\n")
    .replace(/<\/TR>/gi, "\n")
    .replace(/<\/TITLE>/gi, "\n")
    .replace(/<\/(TD|TE|TH)>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\t+/g, "\t")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
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

function getUnit(text: string) {
  if (
    text.includes("단위 : 백만원") ||
    text.includes("단위: 백만원")
  ) {
    return {
      label: "백만원",
      divisor: 1_000_000,
    };
  }

  if (
    text.includes("단위 : 천원") ||
    text.includes("단위: 천원")
  ) {
    return {
      label: "천원",
      divisor: 1_000,
    };
  }

  return {
    label: "원",
    divisor: 1,
  };
}

/*
  ===================================
  계정의 성격이 명확한 경우
  우선 금융수익 / 금융비용 분류
  ===================================
*/

function getStrongCategory(
  account: string
): string | null {
  const normalized =
    normalizeLabel(account);

  if (
    normalized.includes("순금융손익")
  ) {
    return "순금융손익";
  }

  if (
    normalized.includes("금융수익") &&
    (
      normalized.includes("합계") ||
      normalized.includes("소계")
    )
  ) {
    return "금융수익";
  }

  if (
    normalized.includes("금융비용") &&
    (
      normalized.includes("합계") ||
      normalized.includes("소계")
    )
  ) {
    return "금융비용";
  }

  const incomeKeywords = [
    "이자수익",
    "배당수익",
    "배당금수익",
    "평가이익",
    "처분이익",
    "파생상품관련이익",
  ];

  if (
    incomeKeywords.some(
      (keyword) =>
        normalized.includes(keyword)
    )
  ) {
    return "금융수익";
  }

  const expenseKeywords = [
    "이자비용",
    "평가손실",
    "처분손실",
    "파생상품관련손실",
  ];

  if (
    expenseKeywords.some(
      (keyword) =>
        normalized.includes(keyword)
    )
  ) {
    return "금융비용";
  }

  /*
    순금융손익 이후 별도 표시되는
    환율변동효과 등은 억지로
    금융수익/금융비용에 넣지 않는다.
  */

  if (
    normalized.includes(
      "환율변동효과"
    )
  ) {
    return "기타 금융관련";
  }

  return null;
}

/*
  ===================================
  금융수익 / 금융비용 주석 파싱

  1차: 계정명으로 직접 분류
  2차: 외환차이, 기타 등은
       앞뒤 행의 분류로 보완
  ===================================
*/

function parseDisclosureSection(
  text: string
): ParsedRow[] {
  const lines = text
    .split(/\n|\t/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rawRows: RawParsedRow[] = [];

  const ignored = new Set([
    "당기",
    "전기",
    "(단위 : 백만원)",
    "(단위: 백만원)",
    "(단위 : 천원)",
    "(단위: 천원)",
    "(단위 : 원)",
    "(단위: 원)",
    "공시금액",
  ]);

  const amountPattern =
    /^(?:△|-)?[\d,]+(?:\.\d+)?$|^\([\d,]+(?:\.\d+)?\)$/;

  /*
    먼저 계정명 + 금액 행을 순서대로 추출
  */

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line = lines[i];

    if (!amountPattern.test(line)) {
      continue;
    }

    let account = "";

    for (
      let j = i - 1;
      j >= 0;
      j--
    ) {
      const previous =
        lines[j];

      if (
        ignored.has(previous)
      ) {
        continue;
      }

      if (
        amountPattern.test(
          previous
        )
      ) {
        continue;
      }

      account = previous;
      break;
    }

    if (!account) {
      continue;
    }

    const amount =
      parseAmount(line);

    if (amount === null) {
      continue;
    }

    rawRows.push({
      category:
        getStrongCategory(
          account
        ),

      account,
      amount,
    });
  }

  /*
    외환차이 / 기타 등
    계정명만으로 분류하기 어려운 행 보완
  */

  for (
    let i = 0;
    i < rawRows.length;
    i++
  ) {
    if (rawRows[i].category) {
      continue;
    }

    const account =
      normalizeLabel(
        rawRows[i].account
      );

    /*
      환율변동효과는 독립 표시
    */

    if (
      account.includes(
        "환율변동효과"
      )
    ) {
      rawRows[i].category =
        "기타 금융관련";

      continue;
    }

    let previousCategory:
      string | null = null;

    let nextCategory:
      string | null = null;

    /*
      앞쪽에서 가장 가까운
      금융수익 / 금융비용 탐색
    */

    for (
      let j = i - 1;
      j >= 0;
      j--
    ) {
      const category =
        rawRows[j].category;

      if (
        category ===
          "금융수익" ||
        category ===
          "금융비용"
      ) {
        previousCategory =
          category;

        break;
      }
    }

    /*
      뒤쪽에서 가장 가까운
      금융수익 / 금융비용 탐색
    */

    for (
      let j = i + 1;
      j < rawRows.length;
      j++
    ) {
      const category =
        rawRows[j].category;

      if (
        category ===
          "금융수익" ||
        category ===
          "금융비용"
      ) {
        nextCategory =
          category;

        break;
      }
    }

    /*
      앞뒤가 같은 분류면 가장 신뢰도가 높음
    */

    if (
      previousCategory &&
      nextCategory &&
      previousCategory ===
        nextCategory
    ) {
      rawRows[i].category =
        previousCategory;

      continue;
    }

    /*
      한쪽만 존재하면 해당 분류 사용
    */

    if (
      previousCategory &&
      !nextCategory
    ) {
      rawRows[i].category =
        previousCategory;

      continue;
    }

    if (
      !previousCategory &&
      nextCategory
    ) {
      rawRows[i].category =
        nextCategory;

      continue;
    }

    /*
      앞뒤가 다르면 거리가 가까운 쪽 사용
    */

    let previousDistance =
      Number.POSITIVE_INFINITY;

    let nextDistance =
      Number.POSITIVE_INFINITY;

    for (
      let j = i - 1;
      j >= 0;
      j--
    ) {
      if (
        rawRows[j].category ===
          "금융수익" ||
        rawRows[j].category ===
          "금융비용"
      ) {
        previousDistance =
          i - j;

        break;
      }
    }

    for (
      let j = i + 1;
      j < rawRows.length;
      j++
    ) {
      if (
        rawRows[j].category ===
          "금융수익" ||
        rawRows[j].category ===
          "금융비용"
      ) {
        nextDistance =
          j - i;

        break;
      }
    }

    if (
      previousDistance <
        nextDistance &&
      previousCategory
    ) {
      rawRows[i].category =
        previousCategory;
    } else if (
      nextCategory
    ) {
      rawRows[i].category =
        nextCategory;
    } else {
      rawRows[i].category =
        "기타 금융관련";
    }
  }

  return rawRows.map(
    (row) => ({
      category:
        row.category ??
        "기타 금융관련",

      account:
        row.account,

      amount:
        row.amount,
    })
  );
}

/*
  ===================================
  합계 / 소계 / 순금융손익 여부
  ===================================
*/

function isSummaryAccount(
  account: string
) {
  const normalized =
    normalizeLabel(account);

  if (
    normalized.includes(
      "순금융손익"
    )
  ) {
    return true;
  }

  if (
    (
      normalized.includes(
        "금융수익"
      ) ||
      normalized.includes(
        "금융비용"
      )
    ) &&
    (
      normalized.includes(
        "합계"
      ) ||
      normalized.includes(
        "소계"
      )
    )
  ) {
    return true;
  }

  return false;
}

/*
  ===================================
  IFRS 18 검토 정보
  ===================================
*/

function addIfrs18ReviewInfo(
  account: string
) {
  const normalized =
    normalizeLabel(account);

  /*
    합계 / 소계 / 순금융손익은
    독립적인 분류 검토 대상이 아님
  */

  if (
    isSummaryAccount(
      account
    )
  ) {
    return {
      ifrs18_status:
        "합계",

      classification_driver:
        null,

      provisional_category:
        null,

      next_action:
        null,
    };
  }

  if (
    normalized.includes(
      "이자수익"
    )
  ) {
    return {
      ifrs18_status:
        "검토 필요",

      classification_driver:
        "이자수익이 발생한 금융자산의 성격 확인",

      provisional_category:
        null,

      next_action:
        "관련 금융자산 주석 확인",
    };
  }

  if (
    normalized.includes(
      "배당"
    )
  ) {
    return {
      ifrs18_status:
        "검토 필요",

      classification_driver:
        "배당수익을 발생시킨 투자자산의 성격 확인",

      provisional_category:
        null,

      next_action:
        "공정가치금융자산 및 투자자산 주석 확인",
    };
  }

  if (
    normalized.includes(
      "이자비용"
    )
  ) {
    return {
      ifrs18_status:
        "검토 필요",

      classification_driver:
        "이자비용이 발생한 금융부채의 성격 확인",

      provisional_category:
        null,

      next_action:
        "차입금 및 금융부채 주석 확인",
    };
  }

  if (
    normalized.includes(
      "외환"
    ) ||
    normalized.includes(
      "환율변동"
    )
  ) {
    return {
      ifrs18_status:
        "검토 필요",

      classification_driver:
        "환율변동손익이 발생한 자산 또는 부채의 성격 확인",

      provisional_category:
        null,

      next_action:
        "외화표시 자산·부채 및 환위험 주석 확인",
    };
  }

  if (
    normalized.includes(
      "파생상품"
    )
  ) {
    return {
      ifrs18_status:
        "검토 필요",

      classification_driver:
        "파생상품이 관리하는 위험과 기초항목 확인",

      provisional_category:
        null,

      next_action:
        "파생상품 및 위험관리 주석 확인",
    };
  }

  if (
    normalized.includes(
      "평가이익"
    ) ||
    normalized.includes(
      "평가손실"
    )
  ) {
    return {
      ifrs18_status:
        "검토 필요",

      classification_driver:
        "평가손익을 발생시킨 금융상품의 성격 확인",

      provisional_category:
        null,

      next_action:
        "공정가치 측정 및 금융상품 주석 확인",
    };
  }

  if (
    normalized.includes(
      "처분이익"
    ) ||
    normalized.includes(
      "처분손실"
    )
  ) {
    return {
      ifrs18_status:
        "검토 필요",

      classification_driver:
        "처분손익을 발생시킨 금융자산의 성격 확인",

      provisional_category:
        null,

      next_action:
        "금융자산 및 금융상품 주석 확인",
    };
  }

  return {
    ifrs18_status:
      "검토 필요",

    classification_driver:
      "세부 발생 원천 확인",

    provisional_category:
      null,

    next_action:
      "관련 주석 확인",
  };
}

function extractTitles(
  xmlText: string
) {
  const titleRegex =
    /<TITLE\b[^>]*>([\s\S]*?)<\/TITLE>/gi;

  const titles: TitleEntry[] =
    [];

  let match:
    RegExpExecArray | null;

  while (
    (match =
      titleRegex.exec(
        xmlText
      )) !== null
  ) {
    const text =
      cleanText(
        match[1]
      );

    if (!text) {
      continue;
    }

    titles.push({
      text,
      startIndex:
        match.index,
    });
  }

  return titles;
}

function getNoteInfo(
  title: string
) {
  const match =
    title.match(
      /^(\d{1,2})\.\s*(.+)$/
    );

  if (!match) {
    return null;
  }

  return {
    number:
      match[1],

    title:
      match[2].trim(),
  };
}

function isTargetStatementTitle(
  title: string,
  fsDiv: string
) {
  if (fsDiv === "CFS") {
    return title.includes(
      "(연결)"
    );
  }

  return !title.includes(
    "(연결)"
  );
}

function findNote(
  titles: TitleEntry[],
  fsDiv: string,
  keywords: string[]
) {
  for (
    let i = 0;
    i < titles.length;
    i++
  ) {
    const note =
      getNoteInfo(
        titles[i].text
      );

    if (!note) {
      continue;
    }

    if (
      !isTargetStatementTitle(
        note.title,
        fsDiv
      )
    ) {
      continue;
    }

    const matchesAll =
      keywords.every(
        (keyword) =>
          note.title.includes(
            keyword
          )
      );

    if (!matchesAll) {
      continue;
    }

    return {
      index: i,
      ...note,
      startIndex:
        titles[i].startIndex,
    };
  }

  return null;
}

function getNoteXml(
  xmlText: string,
  titles: TitleEntry[],
  fsDiv: string,
  noteIndex: number,
  noteNumber: string
) {
  const start =
    titles[noteIndex]
      .startIndex;

  const nextNumber =
    String(
      Number(noteNumber) + 1
    );

  let end =
    xmlText.length;

  for (
    let i =
      noteIndex + 1;
    i < titles.length;
    i++
  ) {
    const nextNote =
      getNoteInfo(
        titles[i].text
      );

    if (!nextNote) {
      continue;
    }

    if (
      nextNote.number !==
      nextNumber
    ) {
      continue;
    }

    if (
      !isTargetStatementTitle(
        nextNote.title,
        fsDiv
      )
    ) {
      continue;
    }

    end =
      titles[i].startIndex;

    break;
  }

  return xmlText.slice(
    start,
    end
  );
}

function extractTableRows(
  tableXml: string
) {
  const rows:
    string[][] = [];

  const rowRegex =
    /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;

  let rowMatch:
    RegExpExecArray | null;

  while (
    (rowMatch =
      rowRegex.exec(
        tableXml
      )) !== null
  ) {
    const cells:
      string[] = [];

    const cellRegex =
      /<(?:TD|TE|TH)\b[^>]*>([\s\S]*?)<\/(?:TD|TE|TH)>/gi;

    let cellMatch:
      RegExpExecArray | null;

    while (
      (cellMatch =
        cellRegex.exec(
          rowMatch[1]
        )) !== null
    ) {
      cells.push(
        cleanText(
          cellMatch[1]
        )
      );
    }

    if (
      cells.some(
        (cell) =>
          cell !== ""
      )
    ) {
      rows.push(cells);
    }
  }

  return rows;
}

function findEquityMethodRow(
  noteXml: string
) {
  const tableRegex =
    /<TABLE\b[^>]*>([\s\S]*?)<\/TABLE>/gi;

  const tables:
    ExtractedTable[] =
    [];

  let tableMatch:
    RegExpExecArray | null;

  while (
    (tableMatch =
      tableRegex.exec(
        noteXml
      )) !== null
  ) {
    const rows =
      extractTableRows(
        tableMatch[0]
      );

    if (
      rows.length > 0
    ) {
      tables.push({
        rows,
      });
    }
  }

  for (
    const table of
    tables
  ) {
    const labels =
      table.rows.map(
        (row) =>
          normalizeLabel(
            row[0] ?? ""
          )
      );

    const hasBeginning =
      labels.includes(
        "기초"
      );

    const hasEnding =
      labels.includes(
        "기말"
      );

    const hasEquity =
      labels.some(
        (label) =>
          label.includes(
            "지분"
          ) &&
          label.includes(
            "해당액"
          )
      );

    if (
      !hasBeginning ||
      !hasEnding ||
      !hasEquity
    ) {
      continue;
    }

    const row =
      table.rows.find(
        (item) => {
          const label =
            normalizeLabel(
              item[0] ?? ""
            );

          return (
            label.includes(
              "지분법"
            ) ||
            (
              label.includes(
                "지분"
              ) &&
              label.includes(
                "해당액"
              )
            )
          );
        }
      );

    if (row) {
      return row;
    }
  }

  return null;
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

  const requestUrl =
    new URL(request.url);

  const corpCode =
    requestUrl.searchParams.get(
      "corp_code"
    );

  const corpName =
    requestUrl.searchParams.get(
      "corp_name"
    ) ?? "";

  const year =
    requestUrl.searchParams.get(
      "year"
    ) ?? "2025";

  const fsDiv =
    requestUrl.searchParams.get(
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

  /*
    ===================================
    1. 사업보고서 자동 검색
    ===================================
  */

  validateScope(corpCode, year, fsDiv, requestUrl.searchParams.get("rcept_no"));
  const targetReport = await getAnnualReport(corpCode, year, requestUrl.searchParams.get("rcept_no"));
  const rceptNo =
    targetReport.rcept_no;

  /*
    ===================================
    2. 재무제표 API
    ===================================
  */

  const fsParams =
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

  const fsUrl =
    `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${fsParams.toString()}`;

  const fsResponse =
    await fetch(
      fsUrl,
      {
        cache:
          "no-store",
      }
    );

  const fsData =
    await fsResponse.json();

  if (
    fsData.status !==
    "000"
  ) {
    return Response.json(
      {
        error:
          "재무제표 조회에 실패했습니다.",

        dart_response:
          fsData,
      },
      {
        status: 404,
      }
    );
  }

  if (fsData.list?.some((item: { rcept_no?: string }) => item.rcept_no && item.rcept_no !== rceptNo)) return Response.json({error: "재무제표와 원문 접수번호가 다릅니다. 분석을 다시 실행해주세요."}, {status: 409});
  /*
    ===================================
    3. 사업보고서 XML
    ===================================
  */

  const xmlText = await getDocumentXml(rceptNo);
  const titles = await cached("titles:ifrs18-analysis:" + targetReport.rcept_no, () => extractTitles(xmlText));

  /*
    ===================================
    4. 금융수익 및 금융비용 주석
    ===================================
  */

  const financeNote =
    findNote(
      titles,
      fsDiv,
      [
        "금융수익",
        "금융비용",
      ]
    );

  if (!financeNote) {
    return Response.json(
      {
        error:
          "금융수익 및 금융비용 주석을 찾지 못했습니다.",
      },
      {
        status: 404,
      }
    );
  }

  const financeNoteXml =
    getNoteXml(
      xmlText,
      titles,
      fsDiv,
      financeNote.index,
      financeNote.number
    );

  const readableText =
    toReadableText(
      financeNoteXml
    );

  const unit =
    getUnit(
      readableText
    );

  /*
    ===================================
    5. 당기 / 전기 분리
    ===================================
  */

  const currentStart =
    readableText.indexOf(
      "당기"
    );

  const priorStart =
    readableText.indexOf(
      "전기"
    );

  if (
    currentStart === -1 ||
    priorStart === -1
  ) {
    return Response.json(
      {
        error:
          "금융수익·금융비용 주석의 당기/전기 구조를 파싱하지 못했습니다.",

        note_number:
          financeNote.number,

        note_title:
          financeNote.title,

        preview:
          readableText.slice(
            0,
            5000
          ),
      },
      {
        status: 422,
      }
    );
  }

  const descriptionMarker =
    "금융수익 및 금융비용에 대한 기술";

  const descriptionStart =
    readableText.indexOf(
      descriptionMarker
    );

  const currentText =
    readableText.slice(
      currentStart,
      priorStart
    );

  const priorText =
    readableText.slice(
      priorStart,
      descriptionStart >
        -1
        ? descriptionStart
        : readableText.length
    );

  const currentRows =
    parseDisclosureSection(
      currentText
    );

  const priorRows =
    parseDisclosureSection(
      priorText
    );

  const rowMap =
    new Map<
      string,
      {
        category: string;
        account: string;
        current_amount:
          number | null;
        prior_amount:
          number | null;
      }
    >();

  for (
    const row of
    currentRows
  ) {
    const key =
      `${row.category}::${row.account}`;

    rowMap.set(key, {
      category:
        row.category,

      account:
        row.account,

      current_amount:
        row.amount,

      prior_amount:
        null,
    });
  }

  for (
    const row of
    priorRows
  ) {
    const key =
      `${row.category}::${row.account}`;

    const existing =
      rowMap.get(key);

    if (existing) {
      existing.prior_amount =
        row.amount;
    } else {
      rowMap.set(key, {
        category:
          row.category,

        account:
          row.account,

        current_amount:
          null,

        prior_amount:
          row.amount,
      });
    }
  }

  const financialData =
    Array.from(
      rowMap.values()
    ).map(
      (row) => ({
        ...row,

        note_number:
          financeNote.number,

        ...addIfrs18ReviewInfo(
          row.account
        ),
      })
    );

  const description =
    descriptionStart > -1
      ? readableText
          .slice(
            descriptionStart
          )
          .replace(
            descriptionMarker,
            ""
          )
          .trim()
      : null;

  /*
    ===================================
    6. 지분법이익 자동 대사
    ===================================
  */

  let reconciliation: { account: string; statement: { current_amount: number | null; prior_amount: number | null }; note: { note_number: string; note_title: string; source_row: string; current_amount: number | null; prior_amount: number | null }; current_difference: number | null; prior_difference: number | null; current_matched: boolean; prior_matched: boolean; overall_matched: boolean; unit: string } | null = null;

  const equityAccount =
    fsData.list.find(
      (item: { sj_div: string; account_nm: string; thstrm_amount: string; frmtrm_amount: string }) =>
        (
          item.sj_div ===
            "IS" ||
          item.sj_div ===
            "CIS"
        ) &&
        normalizeLabel(
          item.account_nm ??
            ""
        ).includes(
          "지분법이익"
        )
    );

  const equityNote =
    findNote(
      titles,
      fsDiv,
      [
        "관계기업",
        "공동기업",
      ]
    );

  if (
    equityAccount &&
    equityNote
  ) {
    const equityNoteXml =
      getNoteXml(
        xmlText,
        titles,
        fsDiv,
        equityNote.index,
        equityNote.number
      );

    const equityNoteText =
      toReadableText(
        equityNoteXml
      );

    const equityUnit =
      getUnit(
        equityNoteText
      );

    const equityRow =
      findEquityMethodRow(
        equityNoteXml
      );

    if (equityRow) {
      const statementCurrentRaw =
        parseAmount(
          equityAccount
            .thstrm_amount
        );

      const statementPriorRaw =
        parseAmount(
          equityAccount
            .frmtrm_amount
        );

      const statementCurrent =
        statementCurrentRaw !==
        null
          ? statementCurrentRaw /
            equityUnit.divisor
          : null;

      const statementPrior =
        statementPriorRaw !==
        null
          ? statementPriorRaw /
            equityUnit.divisor
          : null;

      const noteCurrent =
        parseAmount(
          equityRow[1]
        );

      const notePrior =
        parseAmount(
          equityRow[2]
        );

      const currentDifference =
        statementCurrent !==
          null &&
        noteCurrent !== null
          ? statementCurrent -
            noteCurrent
          : null;

      const priorDifference =
        statementPrior !==
          null &&
        notePrior !== null
          ? statementPrior -
            notePrior
          : null;

      const tolerance = 1;

      const currentMatched =
        currentDifference !==
        null
          ? Math.abs(
              currentDifference
            ) <= tolerance
          : false;

      const priorMatched =
        priorDifference !==
        null
          ? Math.abs(
              priorDifference
            ) <= tolerance
          : false;

      reconciliation = {
        account:
          equityAccount.account_nm,

        statement: {
          current_amount:
            statementCurrent,

          prior_amount:
            statementPrior,
        },

        note: {
          note_number:
            equityNote.number,

          note_title:
            equityNote.title,

          source_row:
            equityRow[0],

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
          currentMatched &&
          priorMatched,

        unit:
          equityUnit.label,
      };
    }
  }

  /*
    ===================================
    7. 최종 결과
    ===================================
  */

  const detectedCompany =
    fsData.list?.[0]
      ?.corp_name ??
    corpName ??
    corpCode;

  return Response.json({
    company:
      detectedCompany,

    corp_code:
      corpCode,

    year,

    statement_type:
      fsDiv === "CFS"
        ? "연결"
        : "별도",

    fs_div:
      fsDiv,

    report: {
      report_name:
        targetReport.report_nm,

      rcept_no:
        rceptNo,

      rcept_date:
        targetReport.rcept_dt,
    },

    finance_note: {
      note_number:
        financeNote.number,

      note_title:
        financeNote.title,

      unit:
        unit.label,
    },

    financial_data:
      financialData,

    description,

    reconciliation,
  });
  } catch (error) { return apiError(error); }
}
