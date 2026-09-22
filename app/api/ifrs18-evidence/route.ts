import { directAmountMatches, inferTableUnit, unitDivisor } from "@/lib/evidence";
import { apiError, cached, getAnnualReport, getDocumentXml, validateScope } from "@/lib/dart";

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

type TableCell = {
  text: string;
  row_span: number;
  col_span: number;
  header: boolean;
};

type StructuredTable = {
  table_index: number;
  unit: string | null;

  direct_account_score: number;
  contextual_score: number;
  classification_score: number;

  amount_match: boolean;
  direct_account_match: boolean;
  classification_structure: boolean;

  matched_account_terms: string[];
  matched_keywords: string[];

  rows: TableCell[][];
  focused_rows: TableCell[][];
};

function decodeEntities(value: string) {
  return value
    .replace(
      /&nbsp;|&#160;|&#xA0;|&#x20;/gi,
      " "
    )
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanText(value: string) {
  return decodeEntities(value)
    .normalize("NFKC")
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      ""
    )
    .replace(
      /<BR\s*\/?>/gi,
      " "
    )
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string) {
  return cleanText(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function parseAmountText(
  value: string
): number | null {
  let cleaned = cleanText(value)
    .replace(/,/g, "")
    .replace(/\s+/g, "");

  if (
    !cleaned ||
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

  if (Number.isNaN(number)) {
    return null;
  }

  return negative
    ? -number
    : number;
}

function toParagraphText(
  xml: string
) {
  return decodeEntities(
    xml
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
    .replace(/[ \t]+/g, " ")
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

function extractTitles(
  xmlText: string
) {
  const regex =
    /<TITLE\b([^>]*)>([\s\S]*?)<\/TITLE>/gi;

  const titles: TitleEntry[] =
    [];

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(
        xmlText
      )) !== null
  ) {
    const attributes =
      match[1];

    const text =
      cleanText(
        match[2]
      );

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

  let collectedAny =
    false;

  for (const title of titles) {
    if (
      title.text.includes(
        "연결재무제표 주석"
      )
    ) {
      continue;
    }

    if (
      /재무제표 주석$/.test(
        title.text
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
      collectedAny &&
      noteNumber === 1
    ) {
      break;
    }

    notes.push({
      note_number:
        match[1],

      note_title:
        match[2].trim(),

      startIndex:
        title.startIndex,
    });

    collectedAny = true;
  }

  return notes;
}

function getNoteXml(
  xmlText: string,
  notes: NoteHeading[],
  index: number
) {
  const start =
    notes[index].startIndex;

  const next =
    notes[index + 1];

  const end =
    next
      ? next.startIndex
      : Math.min(
          start + 150000,
          xmlText.length
        );

  return xmlText.slice(
    start,
    end
  );
}

function getReviewReason(
  account: string
) {
  const normalized =
    normalizeText(account);

  if (
    normalized.includes(
      "이자수익"
    )
  ) {
    return "이자수익을 발생시킨 금융자산의 성격을 확인해야 합니다.";
  }

  if (
    normalized.includes(
      "이자비용"
    )
  ) {
    return "이자비용을 발생시킨 금융부채의 성격을 확인해야 합니다.";
  }

  if (
    normalized.includes(
      "외환"
    ) ||
    normalized.includes(
      "환율변동"
    )
  ) {
    return "외환손익이 발생한 기초 자산·부채와 환율위험의 성격을 확인해야 합니다.";
  }

  if (
    normalized.includes(
      "파생상품"
    )
  ) {
    return "파생상품이 관리하는 위험과 기초항목을 확인해야 합니다.";
  }

  if (
    normalized.includes(
      "배당"
    )
  ) {
    return "배당수익을 발생시킨 투자자산의 성격을 확인해야 합니다.";
  }

  return "계정의 발생 원천과 관련 자산·부채의 성격을 추가 검토해야 합니다.";
}

function getAccountAliases(
  account: string
) {
  const normalized =
    normalizeText(account);

  if (
    normalized.includes(
      "외환차이"
    )
  ) {
    return [
      "외환차이",
      "외환손익",
      "외화환산손익",
      "환율변동효과",
    ];
  }

  if (
    normalized.includes(
      "환율변동효과"
    )
  ) {
    return [
      "환율변동효과",
      "외환차이",
      "외환손익",
    ];
  }

  if (
    normalized.includes(
      "이자수익"
    )
  ) {
    return [
      "이자수익",
      "금융수익",
    ];
  }

  if (
    normalized.includes(
      "이자비용"
    )
  ) {
    return [
      "이자비용",
      "금융원가",
    ];
  }

  if (
    normalized.includes(
      "배당"
    )
  ) {
    return [
      "배당금수익",
      "배당수익",
    ];
  }

  if (
    normalized.includes(
      "파생상품관련이익"
    )
  ) {
    return [
      "파생상품관련이익",
      "파생상품관련손익",
      "파생상품손익",
    ];
  }

  if (
    normalized.includes(
      "파생상품관련손실"
    )
  ) {
    return [
      "파생상품관련손실",
      "파생상품관련손익",
      "파생상품손익",
    ];
  }

  if (
    normalized.includes(
      "금융상품평가이익"
    )
  ) {
    return [
      "금융상품평가이익",
      "금융상품관련 평가손익",
      "금융상품평가손익",
    ];
  }

  if (
    normalized.includes(
      "금융상품평가손실"
    )
  ) {
    return [
      "금융상품평가손실",
      "금융상품관련 평가손익",
      "금융상품평가손익",
    ];
  }

  if (
    normalized.includes(
      "금융자산처분이익"
    )
  ) {
    return [
      "금융자산처분이익",
      "금융상품관련 처분손익",
      "금융상품처분손익",
    ];
  }

  return [account];
}

function getBodyRules(
  account: string
): KeywordRule[] {
  const normalized =
    normalizeText(account);

  if (
    normalized.includes(
      "외환"
    ) ||
    normalized.includes(
      "환율변동"
    )
  ) {
    return [
      {
        keyword:
          "환율변동위험",
        weight: 80,
      },
      {
        keyword:
          "외환위험",
        weight: 80,
      },
      {
        keyword:
          "외화",
        weight: 35,
      },
      {
        keyword:
          "환율",
        weight: 30,
      },
    ];
  }

  if (
    normalized.includes(
      "파생상품"
    )
  ) {
    return [
      {
        keyword:
          "파생상품",
        weight: 80,
      },
      {
        keyword:
          "위험회피",
        weight: 60,
      },
      {
        keyword:
          "통화선도",
        weight: 50,
      },
      {
        keyword:
          "통화스왑",
        weight: 50,
      },
    ];
  }

  if (
    normalized.includes(
      "이자비용"
    )
  ) {
    return [
      {
        keyword:
          "차입금",
        weight: 70,
      },
      {
        keyword:
          "사채",
        weight: 60,
      },
      {
        keyword:
          "리스부채",
        weight: 50,
      },
    ];
  }

  if (
    normalized.includes(
      "이자수익"
    )
  ) {
    return [
      {
        keyword:
          "이자수익",
        weight: 70,
      },
      {
        keyword:
          "상각후원가",
        weight: 60,
      },
      {
        keyword:
          "금융자산",
        weight: 40,
      },
    ];
  }

  return [
    {
      keyword:
        "금융상품",
      weight: 20,
    },
  ];
}

function scoreText(
  text: string,
  rules: KeywordRule[]
) {
  const matched:
    string[] = [];

  let score = 0;

  for (const rule of rules) {
    if (
      text.includes(
        rule.keyword
      )
    ) {
      matched.push(
        rule.keyword
      );

      score +=
        rule.weight;
    }
  }

  return {
    score,
    matched_keywords:
      matched,
  };
}

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
    Number(match[1]);

  return Number.isNaN(number)
    ? 1
    : number;
}

function rowMatchScore(
  label: string,
  account: string,
  aliases: string[]
) {
  const normalizedLabel =
    normalizeText(label);

  const normalizedAccount =
    normalizeText(account);

  /*
    실제 선택 계정과 완전 일치
  */
  if (
    normalizedLabel ===
    normalizedAccount
  ) {
    return {
      score: 500,
      term: account,
    };
  }

  /*
    실제 선택 계정을 포함
  */
  if (
    normalizedLabel.includes(
      normalizedAccount
    )
  ) {
    return {
      score: 450,
      term: account,
    };
  }

  for (const alias of aliases) {
    const normalizedAlias =
      normalizeText(alias);

    if (
      normalizedLabel ===
      normalizedAlias
    ) {
      return {
        score: 350,
        term: alias,
      };
    }

    if (
      normalizedLabel.includes(
        normalizedAlias
      )
    ) {
      return {
        score: 280,
        term: alias,
      };
    }
  }

  return {
    score: 0,
    term: null,
  };
}

function findDirectRows(
  rows: TableCell[][],
  account: string,
  aliases: string[]
) {
  return rows
    .map(
      (row, index) => {
        const result =
          rowMatchScore(
            row[0]?.text ?? "",
            account,
            aliases
          );

        return {
          index,
          score:
            result.score,
          term:
            result.term,
          row,
        };
      }
    )
    .filter(
      (item) =>
        item.score > 0
    )
    .sort(
      (a, b) =>
        b.score -
        a.score
    );
}

function rowContainsAmount(row: TableCell[], target: number | null) {
  return target !== null && row.slice(1).some(cell => {const amount = parseAmountText(cell.text); return amount !== null && Math.abs(amount - target) <= 0.5;});
}
function isClassificationTable(
  rows: TableCell[][]
) {
  const headerText =
    normalizeText(
      rows
        .slice(0, 5)
        .flat()
        .map(
          (cell) =>
            cell.text
        )
        .join(" ")
    );

  const signals = [
    "금융자산",
    "금융부채",
    "상각후원가",
    "당기손익-공정가치",
    "기타포괄손익-공정가치",
  ];

  const count =
    signals.filter(
      (signal) =>
        headerText.includes(
          normalizeText(
            signal
          )
        )
    ).length;

  const maximumColumns =
    Math.max(
      ...rows.map(
        (row) =>
          row.reduce(
            (
              total,
              cell
            ) =>
              total +
              cell.col_span,
            0
          )
      )
    );

  return (
    count >= 2 &&
    maximumColumns >= 4
  );
}

function buildFocusedRows(
  rows: TableCell[][],
  directRows: ReturnType<
    typeof findDirectRows
  >,
  currentAmount:
    number | null
) {
  if (
    directRows.length === 0
  ) {
    return rows.slice(
      0,
      10
    );
  }

  /*
    같은 계정명이 두 번 존재할 수 있으므로
    선택된 금액과 일치하는 행을 우선한다.
  */

  const amountMatched =
    directRows.find(
      (item) =>
        rowContainsAmount(
          item.row,
          currentAmount
        )
    );

  const target =
    amountMatched ??
    directRows[0];

  const headerRows =
    rows
      .slice(
        0,
        target.index
      )
      .filter(
        (row) =>
          row.some(
            (cell) =>
              cell.header
          )
      );

  return [
    ...headerRows,
    target.row,
  ];
}

function extractTables(
  noteXml: string,
  account: string,
  aliases: string[],
  rules: KeywordRule[],
  currentAmount:
    number | null
): StructuredTable[] {
  const result:
    StructuredTable[] = [];

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

    if (
      rows.length === 0
    ) {
      continue;
    }

    const directRows =
      findDirectRows(
        rows,
        account,
        aliases
      );

    const bestDirect =
      directRows[0];

    const directAccountScore =
      bestDirect?.score ??
      0;

    const preceding = noteXml.slice(0, match.index);
    const inferredUnit = inferTableUnit(tableXml, preceding);
    const amountMatch = directRows.some(item => directAmountMatches(rows, rows.indexOf(item.row), currentAmount, inferredUnit, preceding));
    const combinedText =
      rows
        .flat()
        .map(
          (cell) =>
            cell.text
        )
        .join(" ");

    const contextual =
      scoreText(
        combinedText,
        rules
      );

    const classificationStructure =
      directAccountScore >
        0 &&
      isClassificationTable(
        rows
      );

    const classificationScore =
      classificationStructure
        ? 500 +
          directAccountScore
        : 0;

    const focusedRows =
      buildFocusedRows(
        rows,
        directRows,
        currentAmount === null ? null : currentAmount / (unitDivisor(inferredUnit) ?? 1)
      );

    result.push({
      table_index:
        tableIndex,

      unit: inferredUnit,

      direct_account_score:
        directAccountScore,

      contextual_score:
        contextual.score,

      classification_score:
        classificationScore,

      amount_match:
        amountMatch,

      direct_account_match:
        directAccountScore >
        0,

      classification_structure:
        classificationStructure,

      matched_account_terms:
        directRows
          .map(
            (item) =>
              item.term
          )
          .filter(
            (
              value
            ): value is string =>
              Boolean(value)
          ),

      matched_keywords:
        contextual.matched_keywords,

      rows,

      focused_rows:
        focusedRows,
    });

    tableIndex++;
  }

  return result;
}

function getRelevantParagraphs(
  text: string,
  rules: KeywordRule[]
) {
  return text
    .split(/\n+/)
    .map(
      (paragraph) =>
        paragraph.trim()
    )
    .filter(
      (paragraph) =>
        paragraph.length >
        20
    )
    .map(
      (paragraph) => {
        const result =
          scoreText(
            paragraph,
            rules
          );

        return {
          text:
            paragraph,

          score:
            result.score,

          matched_keywords:
            result.matched_keywords,
        };
      }
    )
    .filter(
      (item) =>
        item.score > 0
    )
    .sort(
      (a, b) =>
        b.score -
        a.score
    )
    .slice(
      0,
      5
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

  const category =
    url.searchParams.get(
      "category"
    );

  const currentAmountText =
    url.searchParams.get(
      "current_amount"
    );

  const currentAmount =
    currentAmountText
      ? Number(
          currentAmountText
        )
      : null;

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

  /*
    1. 사업보고서 조회
  */

  validateScope(corpCode, year, fsDiv, url.searchParams.get("rcept_no"));
  const report = await getAnnualReport(corpCode, year, url.searchParams.get("rcept_no"));
  const xmlText = await getDocumentXml(report.rcept_no);
  const titles = await cached("titles:ifrs18-evidence:" + report.rcept_no, () => extractTitles(xmlText));

  const notes = await cached("notes:ifrs18-evidence:" + report.rcept_no + ":" + fsDiv, () => getNoteHeadings(titles, fsDiv));

  const aliases =
    getAccountAliases(
      account
    );

  const rules =
    getBodyRules(
      account
    );

  const analyzedNotes =
    notes.map(
      (
        note,
        index
      ) => {
        const noteXml =
          getNoteXml(
            xmlText,
            notes,
            index
          );

        const paragraphText =
          toParagraphText(
            noteXml
          );

        const tables =
          extractTables(
            noteXml,
            account,
            aliases,
            rules,
            Number.isFinite(currentAmount) && currentAmount !== null && unitDivisor(url.searchParams.get("unit")) ? currentAmount * unitDivisor(url.searchParams.get("unit"))! : null
          );

        const paragraphs =
          getRelevantParagraphs(
            paragraphText,
            rules
          );

        return {
          ...note,
          tables,
          paragraphs,
        };
      }
    );

  /*
    4. 금액 확인 근거

    선택한 계정명 + 선택한 금액이
    실제로 동시에 나타나는 표를 찾는다.
  */

  const amountCandidates =
    analyzedNotes.flatMap(
      (note) =>
        note.tables
          .filter(
            (table) =>
              table.amount_match
          )
          .map(
            (table) => ({
              note_number:
                note.note_number,

              note_title:
                note.note_title,

              table,
            })
          )
    );

  amountCandidates.sort(
    (a, b) =>
      b.table
        .direct_account_score -
      a.table
        .direct_account_score
  );

  const amountEvidence =
    amountCandidates[0] ??
    null;

  /*
    5. 분류 검토 근거

    계정이 실제 행으로 존재하면서,
    금융자산/금융부채/측정범주 등으로
    분해되는 표를 찾는다.
  */

  const classificationCandidates =
    analyzedNotes.flatMap(
      (note) =>
        note.tables
          .filter(
            (table) =>
              table
                .classification_structure
          )
          .map(
            (table) => ({
              note_number:
                note.note_number,

              note_title:
                note.note_title,

              table,
            })
          )
    );

  classificationCandidates.sort(
    (a, b) =>
      b.table
        .classification_score -
      a.table
        .classification_score
  );

  const classificationEvidence =
    classificationCandidates[0] ??
    null;

  /*
    6. 설명문 근거

    환위험, 파생상품, 차입금 등
    설명 문단을 별도로 찾는다.
  */

  const paragraphCandidates =
    analyzedNotes
      .flatMap(
        (note) =>
          note.paragraphs.map(
            (paragraph) => ({
              note_number:
                note.note_number,

              note_title:
                note.note_title,

              ...paragraph,
            })
          )
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const contextualEvidence =
    paragraphCandidates[0] ??
    null;

  return Response.json({
    corp_code: corpCode,
    fs_div: fsDiv,
    report: { report_name: report.report_nm, rcept_no: report.rcept_no, rcept_date: report.rcept_dt },
    primary_confidence: amountEvidence ? "verified" : classificationEvidence ? "strong" : contextualEvidence ? "review" : null,
    year,

    statement_type:
      fsDiv === "CFS"
        ? "연결"
        : "별도",

    category,

    account,

    current_amount:
      Number.isNaN(
        currentAmount
      )
        ? null
        : currentAmount,

    review_reason:
      getReviewReason(
        account
      ),

    /*
      계정 금액이 실제 주석 금액과
      연결되는지 확인하는 근거
    */
    amount_evidence:
      amountEvidence,

    /*
      IFRS 18 분류 판단을 위해
      발생원천을 세분화해서 보는 근거
    */
    classification_evidence:
      classificationEvidence,

    /*
      관련 위험이나 회계정책을 설명하는
      보조적인 문단 근거
    */
    contextual_evidence:
      contextualEvidence,
  });
  } catch (error) { return apiError(error); }
}
