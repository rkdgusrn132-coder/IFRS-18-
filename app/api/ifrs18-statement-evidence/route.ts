import { canonicalAccount, currentValue, directAmountMatches, equityReconciliation, inferTableUnit, numberFromText, otherIncomeExpenseSection } from "@/lib/evidence";
import { apiError, cached, getAnnualReport, getDocumentXml, validateScope } from "@/lib/dart";

export const runtime = "nodejs";

type TitleEntry = {
  text: string;
  startIndex: number;
  atoc: boolean;
};

type NoteHeading = {
  note_number: string;
  note_title: string;
  startIndex: number;
};

type KeywordRule = {
  keyword: string;
  weight: number;
};

type SearchProfile = {
  aliases: string[];
  titleRules: KeywordRule[];
  bodyRules: KeywordRule[];
  reviewReason: string;
};

type TableCell = {
  text: string;
  row_span: number;
  col_span: number;
  header: boolean;
};

type ReconciliationComponent = {
  label: string;
  amount: number;
};

type TableReconciliation = {
  type: "equity_method_plus_impairment";
  matched: boolean;
  target_amount: number | null;
  calculated_amount: number | null;
  difference: number | null;
  unit: string | null;
  components: ReconciliationComponent[];
};

type TableResult = {
  table_index: number;
  unit: string | null;

  score: number;

  direct_account_score: number;
  amount_match_score: number;
  contextual_score: number;
  reconciliation_score: number;

  direct_account_match: boolean;
  amount_match: boolean;
  matched_amount: number | null;

  matched_account_terms: string[];
  matched_keywords: string[];

  reconciliation: TableReconciliation | null;

  focused_rows: TableCell[][];
  rows: TableCell[][];
};

type ParagraphResult = {
  text: string;
  score: number;
  matched_account_terms: string[];
  matched_keywords: string[];
};

/*
  =========================================================
  문자열
  =========================================================
*/

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;|&#xA0;|&#x20;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanText(value: string) {
  return decodeEntities(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/<BR\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string) {
  return cleanText(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = cleanText(value);

    if (!cleaned) {
      continue;
    }

    const key = normalizeText(cleaned);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function getSearchProfile(
  account: string
): SearchProfile {
  const name =
    normalizeText(account);

  if (
    name === "매출" ||
    name.includes("매출액") ||
    name.includes("영업수익") ||
    name.includes("수익(매출액)")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "매출액",
        "매출",
        "영업수익",
      ]),

      titleRules: [
        {
          keyword: "매출액",
          weight: 260,
        },
        {
          keyword: "매출",
          weight: 200,
        },
        {
          keyword: "고객과의 계약",
          weight: 180,
        },
        {
          keyword: "영업부문",
          weight: 100,
        },
      ],

      bodyRules: [
        {
          keyword: "매출액",
          weight: 90,
        },
        {
          keyword: "고객과의 계약",
          weight: 80,
        },
        {
          keyword: "수익인식",
          weight: 70,
        },
        {
          keyword: "제품",
          weight: 25,
        },
        {
          keyword: "용역",
          weight: 25,
        },
      ],

      reviewReason:
        "매출의 구성과 주요 사업활동에서 발생한 수익의 성격을 확인합니다.",
    };
  }

  if (name.includes("매출원가")) {
    return {
      aliases: uniqueStrings([
        account,
        "매출원가",
      ]),

      titleRules: [
        {
          keyword: "매출원가",
          weight: 260,
        },
        {
          keyword: "비용의 성격",
          weight: 180,
        },
        {
          keyword: "비용의 기능",
          weight: 160,
        },
        {
          keyword: "재고자산",
          weight: 100,
        },
      ],

      bodyRules: [
        {
          keyword: "매출원가",
          weight: 100,
        },
        {
          keyword: "재고자산",
          weight: 55,
        },
        {
          keyword: "원재료",
          weight: 35,
        },
        {
          keyword: "제품",
          weight: 30,
        },
        {
          keyword: "감가상각비",
          weight: 20,
        },
      ],

      reviewReason:
        "매출원가를 구성하는 비용의 성격과 관련 자산·영업활동을 확인합니다.",
    };
  }

  if (
    name.includes("판매비") ||
    name.includes("관리비") ||
    name.includes("판관비")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "판매비와관리비",
        "판매관리비",
        "판관비",
      ]),

      titleRules: [
        {
          keyword: "판매비와관리비",
          weight: 260,
        },
        {
          keyword: "판매관리비",
          weight: 240,
        },
        {
          keyword: "비용의 성격",
          weight: 140,
        },
        {
          keyword: "비용의 기능",
          weight: 130,
        },
      ],

      bodyRules: [
        {
          keyword: "판매비와관리비",
          weight: 100,
        },
        {
          keyword: "급여",
          weight: 25,
        },
        {
          keyword: "감가상각비",
          weight: 25,
        },
        {
          keyword: "광고선전비",
          weight: 25,
        },
        {
          keyword: "연구개발비",
          weight: 25,
        },
      ],

      reviewReason:
        "판매비와관리비의 세부 구성과 비용의 기능·성격을 확인합니다.",
    };
  }

  if (
    name.includes("기타영업외수익") ||
    name.includes("기타수익") ||
    name.includes("기타이익") ||
    name.includes("영업외수익")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "기타영업외수익",
        "기타수익",
        "기타이익",
      ]),

      titleRules: [
        {
          keyword: "기타영업외수익",
          weight: 280,
        },
        {
          keyword: "기타수익",
          weight: 250,
        },
        {
          keyword: "기타손익",
          weight: 180,
        },
        {
          keyword: "기타이익",
          weight: 180,
        },
      ],

      bodyRules: [
        {
          keyword: "기타영업외수익",
          weight: 110,
        },
        {
          keyword: "기타수익",
          weight: 90,
        },
        {
          keyword: "처분이익",
          weight: 35,
        },
        {
          keyword: "평가이익",
          weight: 35,
        },
        {
          keyword: "잡이익",
          weight: 20,
        },
      ],

      reviewReason:
        "기타수익의 세부 발생원천과 관련 자산·거래의 성격을 확인합니다.",
    };
  }

  if (
    name.includes("기타영업외비용") ||
    name.includes("기타비용") ||
    name.includes("기타손실") ||
    name.includes("영업외비용")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "기타영업외비용",
        "기타비용",
        "기타손실",
      ]),

      titleRules: [
        {
          keyword: "기타영업외비용",
          weight: 280,
        },
        {
          keyword: "기타비용",
          weight: 250,
        },
        {
          keyword: "기타손익",
          weight: 180,
        },
        {
          keyword: "기타손실",
          weight: 180,
        },
      ],

      bodyRules: [
        {
          keyword: "기타영업외비용",
          weight: 110,
        },
        {
          keyword: "기타비용",
          weight: 90,
        },
        {
          keyword: "처분손실",
          weight: 35,
        },
        {
          keyword: "평가손실",
          weight: 35,
        },
        {
          keyword: "손상차손",
          weight: 35,
        },
      ],

      reviewReason:
        "기타비용의 세부 발생원천과 관련 자산·거래의 성격을 확인합니다.",
    };
  }

  if (
    name.includes("금융수익") ||
    name.includes("금융이익")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "금융수익",
        "금융이익",
      ]),

      titleRules: [
        {
          keyword: "금융수익",
          weight: 280,
        },
        {
          keyword: "금융비용",
          weight: 120,
        },
        {
          keyword: "금융상품",
          weight: 130,
        },
      ],

      bodyRules: [
        {
          keyword: "금융수익",
          weight: 100,
        },
        {
          keyword: "이자수익",
          weight: 50,
        },
        {
          keyword: "배당금수익",
          weight: 45,
        },
        {
          keyword: "외환차이",
          weight: 40,
        },
      ],

      reviewReason:
        "금융수익의 세부 구성과 이를 발생시킨 금융자산의 성격을 확인합니다.",
    };
  }

  if (
    name.includes("금융비용") ||
    name.includes("금융원가")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "금융비용",
        "금융원가",
      ]),

      titleRules: [
        {
          keyword: "금융비용",
          weight: 280,
        },
        {
          keyword: "금융수익",
          weight: 120,
        },
        {
          keyword: "차입금",
          weight: 130,
        },
        {
          keyword: "금융부채",
          weight: 120,
        },
      ],

      bodyRules: [
        {
          keyword: "금융비용",
          weight: 100,
        },
        {
          keyword: "이자비용",
          weight: 60,
        },
        {
          keyword: "차입금",
          weight: 45,
        },
        {
          keyword: "사채",
          weight: 40,
        },
      ],

      reviewReason:
        "금융비용의 세부 구성과 이를 발생시킨 금융부채·자금조달 구조를 확인합니다.",
    };
  }

  if (
    name.includes("지분법") ||
    name.includes("관계기업") ||
    name.includes("공동기업")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "지분법손익",
        "지분법이익",
        "지분법손실",
        "이익 중 지분해당액",
        "손실 중 지분해당액",
        "지분법투자주식손상차손",
      ]),

      titleRules: [
        {
          keyword: "관계기업 및 공동기업 투자",
          weight: 320,
        },
        {
          keyword: "관계기업",
          weight: 260,
        },
        {
          keyword: "공동기업",
          weight: 260,
        },
        {
          keyword: "지분법",
          weight: 220,
        },
      ],

      bodyRules: [
        {
          keyword: "지분법",
          weight: 100,
        },
        {
          keyword: "관계기업",
          weight: 70,
        },
        {
          keyword: "공동기업",
          weight: 70,
        },
        {
          keyword: "이익 중 지분해당액",
          weight: 90,
        },
        {
          keyword: "손실 중 지분해당액",
          weight: 90,
        },
        {
          keyword: "손상차손",
          weight: 50,
        },
      ],

      reviewReason:
        "관계기업·공동기업 투자 및 지분법 관련 손익의 세부 발생원천을 확인합니다.",
    };
  }

  if (
    name.includes("법인세비용") ||
    name.includes("법인세수익")
  ) {
    return {
      aliases: uniqueStrings([
        account,
        "법인세비용",
        "법인세수익",
        "법인세",
      ]),

      titleRules: [
        {
          keyword: "법인세비용",
          weight: 320,
        },
        {
          keyword: "법인세",
          weight: 300,
        },
      ],

      bodyRules: [
        {
          keyword: "법인세비용",
          weight: 110,
        },
        {
          keyword: "당기법인세",
          weight: 70,
        },
        {
          keyword: "이연법인세",
          weight: 70,
        },
        {
          keyword: "유효세율",
          weight: 45,
        },
      ],

      reviewReason:
        "법인세비용의 구성과 손익계산서에 인식된 세금 관련 금액을 확인합니다.",
    };
  }

  return {
    aliases: uniqueStrings([
      account,
    ]),

    titleRules: [
      {
        keyword: account,
        weight: 220,
      },
    ],

    bodyRules: [
      {
        keyword: account,
        weight: 100,
      },
    ],

    reviewReason:
      "관련 주석에서 계정의 구성과 거래 성격을 확인합니다.",
  };
}

/*
  =========================================================
  TITLE
  =========================================================
*/

function extractTitles(xmlText: string) {
  const regex =
    /<TITLE\b([^>]*)>([\s\S]*?)<\/TITLE>/gi;

  const titles:
    TitleEntry[] = [];

  let match:
    RegExpExecArray | null;

  while (
    (match = regex.exec(xmlText)) !== null
  ) {
    const attributes =
      match[1];

    const text =
      cleanText(match[2]);

    if (!text) {
      continue;
    }

    titles.push({
      text,
      startIndex:
        match.index,
      atoc:
        /ATOC\s*=\s*["']Y["']/i.test(
          attributes
        ),
    });
  }

  return titles;
}

function getNoteHeadings(
  titles: TitleEntry[],
  fsDiv: string
) {
  const pattern =
    /^(\d{1,2})\.\s*(.+)$/;

  const notes:
    NoteHeading[] = [];

  if (fsDiv === "CFS") {
    for (const title of titles) {
      if (!title.atoc) {
        continue;
      }

      const match =
        title.text.match(
          pattern
        );

      if (!match) {
        continue;
      }

      const noteTitle =
        match[2].trim();

      if (
        !noteTitle.includes(
          "(연결)"
        )
      ) {
        continue;
      }

      notes.push({
        note_number:
          match[1],
        note_title:
          noteTitle,
        startIndex:
          title.startIndex,
      });
    }

    return notes;
  }

  let noteAreaStarted =
    false;

  let firstNumber:
    number | null =
    null;

  for (const title of titles) {
    const normalized =
      normalizeText(
        title.text
      );

    if (
      normalized.includes(
        "연결재무제표주석"
      )
    ) {
      continue;
    }

    if (
      normalized.includes(
        "재무제표주석"
      )
    ) {
      noteAreaStarted =
        true;
      continue;
    }

    if (
      !noteAreaStarted ||
      !title.atoc
    ) {
      continue;
    }

    const match =
      title.text.match(
        pattern
      );

    if (!match) {
      continue;
    }

    const noteNumber =
      Number(match[1]);

    if (
      firstNumber === null
    ) {
      firstNumber =
        noteNumber;
    } else if (
      notes.length > 0 &&
      noteNumber ===
        firstNumber
    ) {
      break;
    }

    const noteTitle =
      match[2].trim();

    if (
      noteTitle.includes(
        "(연결)"
      )
    ) {
      continue;
    }

    notes.push({
      note_number:
        match[1],
      note_title:
        noteTitle,
      startIndex:
        title.startIndex,
    });
  }

  return notes;
}

function findNoteSectionEnd(
  titles: TitleEntry[],
  notes: NoteHeading[],
  xmlLength: number
) {
  if (
    notes.length === 0
  ) {
    return xmlLength;
  }

  const lastNote =
    notes[
      notes.length - 1
    ];

  const noteStarts =
    new Set(
      notes.map(
        (note) =>
          note.startIndex
      )
    );

  const nextMajorTitle =
    titles.find(
      (title) => {
        if (
          title.startIndex <=
          lastNote.startIndex
        ) {
          return false;
        }

        if (!title.atoc) {
          return false;
        }

        if (
          noteStarts.has(
            title.startIndex
          )
        ) {
          return false;
        }

        return /^\d+\.\s*\S+/.test(
          title.text
        );
      }
    );

  if (
    nextMajorTitle
  ) {
    return (
      nextMajorTitle
        .startIndex
    );
  }

  return Math.min(
    lastNote.startIndex +
      120000,
    xmlLength
  );
}

function getNoteXml(
  xmlText: string,
  notes: NoteHeading[],
  index: number,
  noteSectionEnd: number
) {
  const start =
    notes[index]
      .startIndex;

  const next =
    notes[
      index + 1
    ];

  const end =
    next
      ? next.startIndex
      : noteSectionEnd;

  return xmlText.slice(
    start,
    Math.max(
      start,
      end
    )
  );
}

/*
  =========================================================
  문단
  =========================================================
*/

function getParagraphText(
  noteXml: string
) {
  return decodeEntities(
    noteXml
      .replace(
        /<TABLE\b[^>]*>[\s\S]*?<\/TABLE>/gi,
        "\n"
      )
      .replace(
        /<BR\s*\/?>/gi,
        "\n"
      )
      .replace(
        /<\/P>/gi,
        "\n"
      )
      .replace(
        /<\/TITLE>/gi,
        "\n"
      )
      .replace(
        /<[^>]+>/g,
        ""
      )
  )
    .normalize("NFKC")
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      ""
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n[ \t]+/g,
      "\n"
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}

function scoreRules(
  text: string,
  rules:
    KeywordRule[]
) {
  const normalized =
    normalizeText(text);

  let score = 0;

  const matched:
    string[] = [];

  for (const rule of rules) {
    if (
      normalized.includes(
        normalizeText(
          rule.keyword
        )
      )
    ) {
      score +=
        rule.weight;

      matched.push(
        rule.keyword
      );
    }
  }

  return {
    score,
    matched_keywords:
      uniqueStrings(
        matched
      ),
  };
}

function getAliasMatches(
  text: string,
  aliases: string[]
) {
  const normalized =
    normalizeText(text);

  return uniqueStrings(
    aliases.filter(
      (alias) =>
        normalized.includes(
          normalizeText(
            alias
          )
        )
    )
  );
}

/*
  =========================================================
  단위
  =========================================================
*/

function inferUnit(tableXml: string, precedingXml: string) { return inferTableUnit(tableXml, precedingXml); }

function getAttributeNumber(
  attributes: string,
  name: string
) {
  const regex =
    new RegExp(
      `${name}\\s*=\\s*["']?(\\d+)["']?`,
      "i"
    );

  const match =
    attributes.match(
      regex
    );

  if (!match) {
    return 1;
  }

  const number =
    Number(
      match[1]
    );

  return Number.isNaN(
    number
  )
    ? 1
    : number;
}

function parseTableRows(
  tableXml: string
) {
  const rows:
    TableCell[][] = [];

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
      TableCell[] = [];

    const cellRegex =
      /<(TD|TE|TH)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

    let cellMatch:
      RegExpExecArray | null;

    while (
      (cellMatch =
        cellRegex.exec(
          rowMatch[1]
        )) !== null
    ) {
      const tag =
        cellMatch[1]
          .toUpperCase();

      const attributes =
        cellMatch[2];

      cells.push({
        text:
          cleanText(
            cellMatch[3]
          ),

        row_span:
          getAttributeNumber(
            attributes,
            "ROWSPAN"
          ),

        col_span:
          getAttributeNumber(
            attributes,
            "COLSPAN"
          ),

        header:
          tag === "TH",
      });
    }

    if (
      cells.some(
        (cell) =>
          cell.text !== ""
      )
    ) {
      rows.push(cells);
    }
  }

  return rows;
}

/*
  =========================================================
  계정 행
  =========================================================
*/

function findBestAccountRow(
  rows:
    TableCell[][],
  account: string,
  aliases: string[]
) {
  const normalizedAccount =
    normalizeText(
      account
    );

  let bestIndex = -1;
  let bestScore = 0;

  let bestTerms:
    string[] = [];

  rows.forEach(
    (
      row,
      rowIndex
    ) => {
      if (!row.slice(1).some(cell => numberFromText(cell.text) !== null)) return;
      const label = row[0]?.text ?? "";

      const normalizedLabel =
        normalizeText(
          label
        );

      let score = 0;

      let terms:
        string[] = [];

      if (
        normalizedLabel ===
        normalizedAccount
      ) {
        score = 500;

        terms = [
          account,
        ];
      } else if (
        normalizedLabel.includes(
          normalizedAccount
        )
      ) {
        score = 440;

        terms = [
          account,
        ];
      }

      for (
        const alias of aliases
      ) {
        const normalizedAlias =
          normalizeText(
            alias
          );

        if (
          !normalizedAlias
        ) {
          continue;
        }

        if (
          normalizedLabel ===
            normalizedAlias &&
          score < 380
        ) {
          score = 380;

          terms.push(
            alias
          );
        } else if (
          normalizedLabel.includes(
            normalizedAlias
          ) &&
          score < 300
        ) {
          score = 300;

          terms.push(
            alias
          );
        }
      }

      if ([account, ...aliases].some(alias => canonicalAccount(alias) === canonicalAccount(label))) { score = 520; terms = [label]; }
      if (
        score > bestScore
      ) {
        bestScore =
          score;

        bestIndex =
          rowIndex;

        bestTerms =
          uniqueStrings(
            terms
          );
      }
    }
  );

  return {
    rowIndex:
      bestIndex,
    score:
      bestScore,
    matchedTerms:
      bestTerms,
  };
}



function isEquityMethodAccount(
  account: string
) {
  const name =
    normalizeText(
      account
    );

  return (
    name.includes("지분법") ||
    name.includes("관계기업") ||
    name.includes("공동기업")
  );
}

function isTotalLabel(
  value: string
) {
  const normalized =
    normalizeText(value);

  return (
    normalized === "합계" ||
    normalized === "합계액" ||
    normalized === "총계"
  );
}



function dedupeRows(
  rows: TableCell[][]
) {
  const seen =
    new Set<string>();

  return rows.filter(
    (row) => {
      const key =
        row
          .map(
            (cell) =>
              cell.text
          )
          .join("||");

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

function buildFocusedRows(
  rows: TableCell[][],
  targetIndex: number,
  account: string,
  reconciliation:
    TableReconciliation | null
) {
  /*
    지분법 대사표는 행 수가 많지 않으면
    전체를 보여준다.

    Reviewer가 어떤 투자회사에서
    손익·손상차손이 발생했는지
    확인할 수 있어야 하기 때문이다.
  */

  if (
    reconciliation?.matched
  ) {
    if (
      rows.length <= 25
    ) {
      return rows;
    }

    const headers =
      rows.filter(
        (row) =>
          row.some(
            (cell) =>
              cell.header
          )
      );

    const totalRows =
      rows.filter(
        (row) =>
          isTotalLabel(
            row[0]?.text ??
              ""
          )
      );

    return dedupeRows([
      ...headers,
      ...totalRows,
    ]);
  }

  if (
    targetIndex < 0
  ) {
    return rows.slice(
      0,
      12
    );
  }

  const sectionRows =
    otherIncomeExpenseSection(
      rows,
      targetIndex,
      account
    );

  if (
    sectionRows
  ) {
    return sectionRows;
  }

  if (
    rows.length <= 30 &&
    targetIndex >=
      Math.floor(
        rows.length *
          0.6
      )
  ) {
    return rows;
  }

  const headers =
    rows
      .slice(
        0,
        targetIndex
      )
      .filter(
        (row) =>
          row.some(
            (cell) =>
              cell.header
          )
      );

  const nearbyStart =
    Math.max(
      0,
      targetIndex - 2
    );

  const nearbyEnd =
    Math.min(
      rows.length,
      targetIndex + 3
    );

  const nearbyRows =
    rows.slice(
      nearbyStart,
      nearbyEnd
    );

  return dedupeRows([
    ...headers,
    ...nearbyRows,
  ]);
}

/*
  =========================================================
  TABLE 분석
  =========================================================
*/

function analyzeTables(
  noteXml: string,
  account: string,
  profile:
    SearchProfile,
  currentAmount:
    number | null
) {
  const result:
    TableResult[] = [];

  const tableRegex =
    /<TABLE\b[^>]*>[\s\S]*?<\/TABLE>/gi;

  let match:
    RegExpExecArray | null;

  let tableIndex = 0;

  while (
    (match =
      tableRegex.exec(
        noteXml
      )) !== null
  ) {
    const tableXml =
      match[0];

    const rows =
      parseTableRows(
        tableXml
      );

    if (
      rows.length === 0
    ) {
      tableIndex++;
      continue;
    }

    const precedingXml = noteXml.slice(0, match.index);

    const unit =
      inferUnit(
        tableXml,
        precedingXml
      );

    const accountMatch =
      findBestAccountRow(
        rows,
        account,
        profile.aliases
      );

    const combinedText =
      rows
        .flat()
        .map(
          (cell) =>
            cell.text
        )
        .join(" ");

    const contextual =
      scoreRules(
        combinedText,
        profile.bodyRules
      );

    const semanticMatch = accountMatch.rowIndex >= 0 && [account, ...profile.aliases].some(alias => canonicalAccount(alias) === canonicalAccount(rows[accountMatch.rowIndex][0]?.text ?? ""));
    const amountMatch = semanticMatch && directAmountMatches(rows, accountMatch.rowIndex, currentAmount, unit, precedingXml);
    const reconciliation = isEquityMethodAccount(account) ? equityReconciliation(rows, currentAmount, unit, precedingXml) : null;
    const amountMatchScore =
      amountMatch
        ? 350
        : 0;

    const reconciliationScore =
      reconciliation?.matched
        ? 650
        : 0;

    const totalScore =
      accountMatch.score +
      amountMatchScore +
      reconciliationScore +
      Math.min(
        contextual.score,
        150
      );

    if (
      totalScore > 0
    ) {
      result.push({
        table_index:
          tableIndex,

        unit,

        score:
          totalScore,

        direct_account_score:
          accountMatch.score,

        amount_match_score:
          amountMatchScore,

        contextual_score:
          contextual.score,

        reconciliation_score:
          reconciliationScore,

        direct_account_match:
          accountMatch.score >
          0,

        amount_match: amountMatch,
        matched_amount: amountMatch ? currentValue(rows, accountMatch.rowIndex, precedingXml) : null,

        matched_account_terms:
          accountMatch
            .matchedTerms,

        matched_keywords:
          contextual
            .matched_keywords,

        reconciliation,

        focused_rows:
          buildFocusedRows(
            rows,
            accountMatch.rowIndex,
            account,
            reconciliation
          ),

        rows,
      });
    }

    tableIndex++;
  }

  return result.sort(
    (a, b) =>
      b.score -
      a.score
  );
}

/*
  =========================================================
  문단
  =========================================================
*/

function analyzeParagraphs(
  noteXml: string,
  profile:
    SearchProfile
) {
  const text =
    getParagraphText(
      noteXml
    );

  const paragraphs =
    text
      .split(/\n+/)
      .map(
        (paragraph) =>
          paragraph.trim()
      )
      .filter(
        (paragraph) =>
          paragraph.length >=
          25
      );

  const results:
    ParagraphResult[] =
    [];

  for (
    const paragraph of paragraphs
  ) {
    const matchedAliases =
      getAliasMatches(
        paragraph,
        profile.aliases
      );

    const contextual =
      scoreRules(
        paragraph,
        profile.bodyRules
      );

    let directScore = 0;

    if (
      matchedAliases.length >
      0
    ) {
      directScore =
        120 +
        matchedAliases.length *
          20;
    }

    const score =
      directScore +
      contextual.score;

    if (
      score <= 0
    ) {
      continue;
    }

    results.push({
      text:
        paragraph,

      score,

      matched_account_terms:
        matchedAliases,

      matched_keywords:
        contextual
          .matched_keywords,
    });
  }

  return results
    .sort(
      (a, b) =>
        b.score -
        a.score
    )
    .slice(0, 4);
}

/*
  =========================================================
  API
  =========================================================
*/

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

  const year =
    url.searchParams.get(
      "year"
    ) ?? "2025";

  const fsDiv =
    url.searchParams.get(
      "fs_div"
    ) ?? "CFS";

  const account =
    url.searchParams.get(
      "account"
    );

  const currentAmountText =
    url.searchParams.get(
      "current_amount"
    );

  const parsedCurrentAmount =
    currentAmountText
      ? Number(
          currentAmountText
        )
      : null;

  const currentAmount =
    parsedCurrentAmount ===
      null ||
    Number.isNaN(
      parsedCurrentAmount
    )
      ? null
      : parsedCurrentAmount;

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

  if (!account) {
    return Response.json(
      {
        error:
          "account가 필요합니다.",
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

  const profile =
    getSearchProfile(
      account
    );

  /*
    사업보고서 검색
  */

  validateScope(corpCode, year, fsDiv, url.searchParams.get("rcept_no"));
  const report = await getAnnualReport(corpCode, year, url.searchParams.get("rcept_no"));
  const xmlText = await getDocumentXml(report.rcept_no);
  const titles = await cached("titles:ifrs18-statement-evidence:" + report.rcept_no, () => extractTitles(xmlText));

  const notes = await cached("notes:ifrs18-statement-evidence:" + report.rcept_no + ":" + fsDiv, () => getNoteHeadings(titles, fsDiv));

  if (
    notes.length === 0
  ) {
    return Response.json(
      {
        error:
          "재무제표 주석 목록을 찾지 못했습니다.",
      },
      {
        status: 404,
      }
    );
  }

  const noteSectionEnd =
    findNoteSectionEnd(
      titles,
      notes,
      xmlText.length
    );

  /*
    전체 주석 분석
  */

  const candidates =
    notes
      .map(
        (
          note,
          index
        ) => {
          const noteXml =
            getNoteXml(
              xmlText,
              notes,
              index,
              noteSectionEnd
            );

          const titleRuleResult =
            scoreRules(
              note.note_title,
              profile.titleRules
            );

          const titleAliasMatches =
            getAliasMatches(
              note.note_title,
              profile.aliases
            );

          const titleAliasScore =
            titleAliasMatches.length >
            0
              ? 220 +
                titleAliasMatches.length *
                  20
              : 0;

          const titleScore =
            titleRuleResult.score +
            titleAliasScore;

          const tables = /현금흐름/.test(note.note_title) ? [] : analyzeTables(
              noteXml,
              account,
              profile,
              currentAmount
            );

          const bestTable =
            tables[0] ??
            null;

          const paragraphs =
            analyzeParagraphs(
              noteXml,
              profile
            );

          const bestParagraph =
            paragraphs[0] ??
            null;

          const score =
            titleScore +
            (bestTable?.score ??
              0) +
            Math.min(
              bestParagraph?.score ??
                0,
              200
            );

          let evidenceType =
            "contextual";

          if (
            bestTable
              ?.amount_match &&
            bestTable
              ?.direct_account_match
          ) {
            evidenceType =
              "direct_amount_table";
          } else if (
            bestTable
              ?.reconciliation
              ?.matched
          ) {
            evidenceType =
              "reconciled_table";
          } else if (
            bestTable
              ?.direct_account_match
          ) {
            evidenceType =
              "direct_table";
          } else if (
            titleScore > 0
          ) {
            evidenceType =
              "title_match";
          }

          return {
            note_number:
              note.note_number,

            note_title:
              note.note_title,

            score,

            evidence_type:
              evidenceType,

            title_score:
              titleScore,

            matched_title_keywords:
              titleRuleResult
                .matched_keywords,

            matched_title_account_terms:
              titleAliasMatches,

            paragraphs,

            tables:
              tables.slice(
                0,
                3
              ),
          };
        }
      )
      .filter(
        (candidate) =>
          candidate.score >=
          80
      )
      .sort((a, b) => {
        const rank = (type: string) => ["contextual", "title_match", "direct_table", "reconciled_table", "direct_amount_table"].indexOf(type);
        return rank(b.evidence_type) - rank(a.evidence_type) || b.score - a.score;
      });

  const evidence =
    candidates.slice(
      0,
      5
    );

  const primaryEvidence =
    evidence[0] ??
    null;

  let primaryConfidence:
    | "verified"
    | "reconciled"
    | "strong"
    | "review"
    | null =
    null;

  if (
    primaryEvidence
      ?.evidence_type ===
    "direct_amount_table"
  ) {
    primaryConfidence =
      "verified";
  } else if (
    primaryEvidence
      ?.evidence_type ===
    "reconciled_table"
  ) {
    primaryConfidence =
      "reconciled";
  } else if (
    primaryEvidence
      ?.evidence_type ===
    "direct_table"
  ) {
    primaryConfidence =
      "strong";
  } else if (
    primaryEvidence
  ) {
    primaryConfidence =
      "review";
  }

  return Response.json({
    company:
      report.corp_name ??
      null,

    corp_code:
      corpCode,

    year,

    statement_type:
      fsDiv === "CFS"
        ? "연결"
        : "별도",

    account,

    current_amount:
      currentAmount,

    review_reason:
      profile.reviewReason,

    search_profile: {
      aliases:
        profile.aliases,

      title_keywords:
        profile.titleRules.map(
          (item) =>
            item.keyword
        ),

      body_keywords:
        profile.bodyRules.map(
          (item) =>
            item.keyword
        ),
    },

    report: {
      report_name:
        report.report_nm,

      rcept_no:
        report.rcept_no,

      rcept_date:
        report.rcept_dt,
    },

    parser_info: {
      note_count:
        notes.length,

      note_section_end:
        noteSectionEnd,

      main_xml_size:
        xmlText.length,

      minimum_candidate_score:
        80,
    },

    candidate_count:
      candidates.length,

    primary_confidence:
      primaryConfidence,

    primary_evidence:
      primaryEvidence,

    evidence,
  });
  } catch (error) { return apiError(error); }
}
