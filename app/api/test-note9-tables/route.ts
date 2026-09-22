import AdmZip from "adm-zip";

type TitleEntry = {
  text: string;
  startIndex: number;
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
      const text = cleanText(cellMatch[1]);

      cells.push(text);
    }

    const hasMeaningfulValue =
      cells.some(
        (cell) => cell.trim() !== ""
      );

    if (hasMeaningfulValue) {
      rows.push(cells);
    }
  }

  return rows;
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

  const rceptNo = "20260310002820";

  const dartUrl =
    `https://opendart.fss.or.kr/api/document.xml` +
    `?crtfc_key=${dartApiKey}` +
    `&rcept_no=${rceptNo}`;

  const response = await fetch(dartUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    return Response.json({
      error:
        "DART 원문 다운로드에 실패했습니다.",
      status: response.status,
    });
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  const zip =
    new AdmZip(buffer);

  const mainEntry = zip
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
    TITLE 태그들의 위치를 찾는다.
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

  /*
    연결 주석 9:
    관계기업 및 공동기업 투자

    다음 연결 주석 10:
    유형자산

    이 두 제목 사이를 잘라낸다.
  */

  const note9Index =
    titles.findIndex(
      (title) =>
        title.text ===
        "9. 관계기업 및 공동기업 투자 (연결)"
    );

  if (note9Index === -1) {
    return Response.json({
      error:
        "연결 주석 9을 찾지 못했습니다.",
    });
  }

  const note10Index =
    titles.findIndex(
      (title, index) =>
        index > note9Index &&
        title.text ===
          "10. 유형자산 (연결)"
    );

  if (note10Index === -1) {
    return Response.json({
      error:
        "연결 주석 10을 찾지 못했습니다.",
    });
  }

  const note9Xml =
    xmlText.slice(
      titles[note9Index].startIndex,
      titles[note10Index].startIndex
    );

  /*
    주석 9 내부 TABLE 전부 추출
  */

  const tableRegex =
    /<TABLE\b[^>]*>([\s\S]*?)<\/TABLE>/gi;

  const tables: {
    table_index: number;
    row_count: number;
    keyword_hits: string[];
    preview_rows: string[][];
  }[] = [];

  const importantKeywords = [
    "관계기업",
    "공동기업",
    "회사명",
    "기업명",
    "소재지",
    "지분율",
    "소유지분율",
    "장부금액",
    "취득원가",
    "순자산",
    "당기순이익",
    "지분법",
    "배당",
  ];

  let tableMatch:
    RegExpExecArray | null;

  let tableIndex = 0;

  while (
    (tableMatch =
      tableRegex.exec(note9Xml)) !== null
  ) {
    const tableXml =
      tableMatch[0];

    const rows =
      extractTableRows(tableXml);

    if (rows.length === 0) {
      continue;
    }

    const combinedText =
      rows
        .flat()
        .join(" ");

    const keywordHits =
      importantKeywords.filter(
        (keyword) =>
          combinedText.includes(keyword)
      );

    tables.push({
      table_index:
        tableIndex,

      row_count:
        rows.length,

      keyword_hits:
        keywordHits,

      /*
        우선 각 표의 앞 12행만 보여준다.
        다음 단계에서 원하는 표를 골라
        전체 행을 구조화할 예정.
      */
      preview_rows:
        rows.slice(0, 12),
    });

    tableIndex++;
  }

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

    source_file:
      mainEntry.entryName,

    section_size:
      note9Xml.length,

    table_count:
      tables.length,

    tables,
  });
}