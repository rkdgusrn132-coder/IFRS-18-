import AdmZip from "adm-zip";

function cleanText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

type TitleItem = {
  text: string;
  atoc: boolean;
};

type NoteHeading = {
  note_number: string;
  note_title: string;
  statement_type: "연결";
};

type ReviewTarget = {
  account: string;
  reason: string;
  keywords: string[];
};

function getMatchInfo(
  title: string,
  keywords: string[]
) {
  const matchedKeywords = keywords.filter((keyword) =>
    title.includes(keyword)
  );

  if (matchedKeywords.length === 0) {
    return {
      score: 0,
      matched_keywords: [],
    };
  }

  let score = matchedKeywords.length * 10;

  // 실제 관련 키워드가 존재하는 경우에만
  // 연결재무제표 주석에 가산점
  if (title.includes("(연결)")) {
    score += 3;
  }

  return {
    score,
    matched_keywords: matchedKeywords,
  };
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({error:"개발용 진단 경로입니다."}, {status:404});
  const dartApiKey = process.env.DART_API_KEY;

  if (!dartApiKey) {
    return Response.json({
      error: "DART_API_KEY가 없습니다",
    });
  }

  const rceptNo = "20260310002820";

  const url =
    `https://opendart.fss.or.kr/api/document.xml` +
    `?crtfc_key=${dartApiKey}` +
    `&rcept_no=${rceptNo}`;

  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    return Response.json({
      error: "DART 원문 다운로드에 실패했습니다.",
      status: response.status,
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const zip = new AdmZip(buffer);

  const mainEntry = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .sort((a, b) => b.header.size - a.header.size)[0];

  if (!mainEntry) {
    return Response.json({
      error: "사업보고서 XML을 찾지 못했습니다.",
    });
  }

  const xmlText = mainEntry
    .getData()
    .toString("utf8");

  /*
    1. XML의 TITLE 태그를 순서대로 추출
  */

  const titleRegex =
    /<TITLE\b([^>]*)>([\s\S]*?)<\/TITLE>/gi;

  const allTitles: TitleItem[] = [];

  let titleMatch: RegExpExecArray | null;

  while (
    (titleMatch = titleRegex.exec(xmlText)) !== null
  ) {
    const attributes = titleMatch[1];
    const innerText = titleMatch[2];

    const text = cleanText(innerText);

    if (!text) {
      continue;
    }

    allTitles.push({
      text,
      atoc: /ATOC\s*=\s*["']Y["']/i.test(
        attributes
      ),
    });
  }

  /*
    2. "3. 연결재무제표 주석" 이후부터
       "4. 재무제표" 전까지만 사용

       이렇게 하면 별도재무제표 주석과
       사업보고서 다른 섹션이 섞이지 않는다.
  */

  const connectedNotesStart =
    allTitles.findIndex(
      (item) =>
        item.text === "3. 연결재무제표 주석"
    );

  const separateStatementsStart =
    allTitles.findIndex(
      (item, index) =>
        index > connectedNotesStart &&
        item.text === "4. 재무제표"
    );

  if (
    connectedNotesStart === -1 ||
    separateStatementsStart === -1
  ) {
    return Response.json({
      error:
        "연결재무제표 주석 범위를 찾지 못했습니다.",
    });
  }

  const connectedTitles = allTitles.slice(
    connectedNotesStart + 1,
    separateStatementsStart
  );

  /*
    3. 연결재무제표 주석 제목 추출
  */

  const headingPattern =
    /^(\d{1,2})\.\s*(.+)$/;

  const noteHeadings: NoteHeading[] = [];

  for (const title of connectedTitles) {
    if (!title.atoc) {
      continue;
    }

    const match = title.text.match(
      headingPattern
    );

    if (!match) {
      continue;
    }

    const noteNumber = match[1];
    const noteTitle = match[2].trim();

    if (!noteTitle.includes("(연결)")) {
      continue;
    }

    noteHeadings.push({
      note_number: noteNumber,
      note_title: noteTitle,
      statement_type: "연결",
    });
  }

  /*
    4. IFRS 18 검토 대상별
       관련 주석 검색 규칙
  */

  const reviewTargets: ReviewTarget[] = [
    {
      account:
        "상각후원가 측정 금융부채 이자비용",

      reason:
        "이자비용이 발생한 금융부채의 성격 확인",

      keywords: [
        "범주별 금융상품",
        "차입금",
        "사채",
        "리스부채",
      ],
    },

    {
      account:
        "기타 금융부채 이자비용",

      reason:
        "기타 금융부채 이자비용의 발생 원천 확인",

      keywords: [
        "범주별 금융상품",
        "차입금",
        "사채",
        "리스부채",
      ],
    },

    {
      account:
        "상각후원가로 측정하는 금융자산의 이자수익",

      reason:
        "이자수익을 발생시킨 금융자산의 성격 확인",

      keywords: [
        "범주별 금융상품",
        "금융자산의 양도",
        "공정가치금융자산",
      ],
    },

    {
      account: "외환차이",

      reason:
        "외환차이가 발생한 자산 또는 부채 확인",

      keywords: [
        "재무위험관리",
        "범주별 금융상품",
      ],
    },

    {
      account:
        "파생상품관련이익/손실",

      reason:
        "파생상품이 관리하는 위험과 기초항목 확인",

      keywords: [
        "재무위험관리",
        "범주별 금융상품",
      ],
    },

    {
      account: "지분법이익",

      reason:
        "관계기업 및 공동기업 투자 성격 확인",

      keywords: [
        "관계기업 및 공동기업 투자",
      ],
    },
  ];

  /*
    5. 계정별 관련 주석 후보 점수화
  */

  const accountNoteLinks =
    reviewTargets.map((target) => {
      const candidates = noteHeadings
        .map((note) => {
          const matchInfo =
            getMatchInfo(
              note.note_title,
              target.keywords
            );

          return {
            ...note,
            ...matchInfo,
          };
        })
        .filter(
          (note) => note.score > 0
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

      return {
        account: target.account,
        reason: target.reason,

        // 가장 우선적으로 볼 주석
        primary_note:
          candidates.length > 0
            ? candidates[0]
            : null,

        // 다른 관련 후보
        related_notes: candidates,
      };
    });

  return Response.json({
    company: "삼성전자",
    year: "2025",
    statement_type: "연결",

    source_file:
      mainEntry.entryName,

    connected_note_count:
      noteHeadings.length,

    connected_note_headings:
      noteHeadings,

    account_note_links:
      accountNoteLinks,
  });
}