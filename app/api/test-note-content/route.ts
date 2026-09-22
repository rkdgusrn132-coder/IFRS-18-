import AdmZip from "adm-zip";

type TitleEntry = {
  text: string;
  startIndex: number;
  endIndex: number;
  atoc: boolean;
};

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

function toReadableText(xml: string) {
  return xml
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

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({error:"개발용 진단 경로입니다."}, {status:404});
  const dartApiKey = process.env.DART_API_KEY;

  if (!dartApiKey) {
    return Response.json({
      error: "DART_API_KEY가 없습니다",
    });
  }

  /*
    주소 예시:
    /api/test-note-content?note=9

    note가 없으면 기본값으로 9 사용
  */
  const requestUrl = new URL(request.url);

  const requestedNote =
    requestUrl.searchParams.get("note") ?? "9";

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
    모든 TITLE 태그를
    XML 위치와 함께 저장
  */

  const titleRegex =
    /<TITLE\b([^>]*)>([\s\S]*?)<\/TITLE>/gi;

  const titles: TitleEntry[] = [];

  let match:
    RegExpExecArray | null;

  while (
    (match =
      titleRegex.exec(xmlText)) !==
    null
  ) {
    const attributes =
      match[1];

    const innerText =
      match[2];

    const text =
      cleanText(innerText);

    if (!text) {
      continue;
    }

    titles.push({
      text,

      startIndex:
        match.index,

      endIndex:
        titleRegex.lastIndex,

      atoc:
        /ATOC\s*=\s*["']Y["']/i.test(
          attributes
        ),
    });
  }

  /*
    연결재무제표 주석 영역 확인

    시작:
    3. 연결재무제표 주석

    종료:
    4. 재무제표
  */

  const connectedStartIndex =
    titles.findIndex(
      (title) =>
        title.text ===
        "3. 연결재무제표 주석"
    );

  const separateStartIndex =
    titles.findIndex(
      (title, index) =>
        index >
          connectedStartIndex &&
        title.text ===
          "4. 재무제표"
    );

  if (
    connectedStartIndex === -1 ||
    separateStartIndex === -1
  ) {
    return Response.json({
      error:
        "연결재무제표 주석 영역을 찾지 못했습니다.",
    });
  }

  const connectedTitles =
    titles.slice(
      connectedStartIndex + 1,
      separateStartIndex
    );

  /*
    연결 주석 제목만 추출

    예:
    9. 관계기업 및 공동기업 투자 (연결)
    12. 차입금 (연결)
    28. 재무위험관리 (연결)
  */

  const noteHeadingPattern =
    /^(\d{1,2})\.\s*(.+)$/;

  const connectedNoteTitles =
    connectedTitles.filter(
      (title) => {
        const headingMatch =
          title.text.match(
            noteHeadingPattern
          );

        if (!headingMatch) {
          return false;
        }

        return headingMatch[2]
          .trim()
          .includes("(연결)");
      }
    );

  /*
    요청받은 주석 찾기
  */

  const targetIndex =
    connectedNoteTitles.findIndex(
      (title) => {
        const headingMatch =
          title.text.match(
            noteHeadingPattern
          );

        if (!headingMatch) {
          return false;
        }

        return (
          headingMatch[1] ===
          requestedNote
        );
      }
    );

  if (targetIndex === -1) {
    return Response.json({
      error:
        `연결재무제표 주석 ${requestedNote}번을 찾지 못했습니다.`,

      available_notes:
        connectedNoteTitles.map(
          (title) =>
            title.text
        ),
    });
  }

  const targetTitle =
    connectedNoteTitles[
      targetIndex
    ];

  /*
    다음 주석 시작 위치를
    현재 주석의 종료 위치로 사용
  */

  const nextTitle =
    connectedNoteTitles[
      targetIndex + 1
    ];

  const sectionStart =
    targetTitle.startIndex;

  const sectionEnd =
    nextTitle
      ? nextTitle.startIndex
      : titles[
          separateStartIndex
        ].startIndex;

  const noteXml =
    xmlText.slice(
      sectionStart,
      sectionEnd
    );

  const readableText =
    toReadableText(noteXml);

  /*
    주석번호와 제목 분리
  */

  const targetHeadingMatch =
    targetTitle.text.match(
      noteHeadingPattern
    );

  const noteNumber =
    targetHeadingMatch
      ? targetHeadingMatch[1]
      : requestedNote;

  const noteTitle =
    targetHeadingMatch
      ? targetHeadingMatch[2]
          .replace(
            /\s*\(연결\)\s*$/,
            ""
          )
          .trim()
      : targetTitle.text;

  return Response.json({
    company:
      "삼성전자",

    year:
      "2025",

    statement_type:
      "연결",

    note_number:
      noteNumber,

    note_title:
      noteTitle,

    source_file:
      mainEntry.entryName,

    section_size:
      noteXml.length,

    preview:
      readableText.slice(
        0,
        15000
      ),
  });
}