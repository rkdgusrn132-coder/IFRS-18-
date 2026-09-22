import AdmZip from "adm-zip";

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

function parseAmount(value: string) {
  const cleaned = value.replace(/,/g, "").trim();

  if (cleaned.startsWith("△")) {
    return -Number(cleaned.replace("△", ""));
  }

  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    return -Number(
      cleaned.replace("(", "").replace(")", "")
    );
  }

  return Number(cleaned);
}

function parseDisclosureSection(text: string) {
  const lines = text
    .split(/\n|\t/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: {
    category: string;
    account: string;
    amount: number;
  }[] = [];

  let category = "";

  const ignored = new Set([
    "당기",
    "전기",
    "(단위 : 백만원)",
    "공시금액",
  ]);

  const amountPattern =
    /^(?:△|-)?[\d,]+(?:\.\d+)?$|^\([\d,]+(?:\.\d+)?\)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === "금융수익 합계") {
      category = "금융수익";
    }

    if (line === "금융비용 합계") {
      category = "금융비용";
    }

    if (!amountPattern.test(line)) {
      continue;
    }

    let account = "";

    for (let j = i - 1; j >= 0; j--) {
      const previous = lines[j];

      if (ignored.has(previous)) {
        continue;
      }

      if (amountPattern.test(previous)) {
        continue;
      }

      account = previous;
      break;
    }

    if (!account) {
      continue;
    }

    rows.push({
      category,
      account,
      amount: parseAmount(line),
    });
  }

  return rows;
}

function addIfrs18ReviewInfo(account: string) {
  if (
    account.includes("금융수익 합계") ||
    account.includes("금융비용 합계")
  ) {
    return {
      ifrs18_status: "합계",
      classification_driver: null,
      provisional_category: null,
      next_action: null,
    };
  }

  if (account.includes("이자수익")) {
    return {
      ifrs18_status: "검토 필요",
      classification_driver:
        "이자수익이 발생한 금융자산의 성격 확인",
      provisional_category: null,
      next_action: "관련 금융자산 주석 확인",
    };
  }

  if (account.includes("이자비용")) {
    return {
      ifrs18_status: "검토 필요",
      classification_driver:
        "이자비용이 발생한 금융부채의 성격 확인",
      provisional_category: null,
      next_action: "차입금 및 금융부채 주석 확인",
    };
  }

  if (account.includes("외환차이")) {
    return {
      ifrs18_status: "검토 필요",
      classification_driver:
        "외환차이가 발생한 자산 또는 부채의 성격 확인",
      provisional_category: null,
      next_action: "외화표시 자산·부채의 발생 원천 확인",
    };
  }

  if (
    account.includes("파생상품관련이익") ||
    account.includes("파생상품관련손실")
  ) {
    return {
      ifrs18_status: "검토 필요",
      classification_driver:
        "파생상품이 관리하는 위험의 성격 확인",
      provisional_category: null,
      next_action: "파생상품 및 위험관리 주석 확인",
    };
  }

  return {
    ifrs18_status: "검토 필요",
    classification_driver: "세부 발생 원천 확인",
    provisional_category: null,
    next_action: "관련 주석 확인",
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

  const note24Regex =
    /24\.\s*(?:<[^>]+>\s*)*금융수익\s*(?:<[^>]+>\s*)*및\s*(?:<[^>]+>\s*)*금융비용/gi;

  const note25Regex =
    /25\.\s*(?:<[^>]+>\s*)*법인세비용/gi;

  const note24Matches = [
    ...xmlText.matchAll(note24Regex),
  ];

  const note25Matches = [
    ...xmlText.matchAll(note25Regex),
  ];

  const candidates = note24Matches
    .map((startMatch) => {
      const startIndex =
        startMatch.index ?? -1;

      const nextNote25 =
        note25Matches.find(
          (match) =>
            (match.index ?? -1) >
            startIndex
        );

      if (
        startIndex === -1 ||
        !nextNote25
      ) {
        return null;
      }

      const endIndex =
        nextNote25.index ?? -1;

      return {
        startIndex,
        endIndex,
        length:
          endIndex - startIndex,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        startIndex: number;
        endIndex: number;
        length: number;
      } =>
        candidate !== null &&
        candidate.length > 5000
    );

  if (candidates.length === 0) {
    return Response.json({
      error:
        "주석 24를 찾지 못했습니다.",
    });
  }

  // 현재는 첫 번째 큰 구간을 연결재무제표 주석으로 사용
  const selected = candidates[0];

  const note24Xml = xmlText.slice(
    selected.startIndex,
    selected.endIndex
  );

  const readableText =
    toReadableText(note24Xml);

  const currentStart =
    readableText.indexOf("당기");

  const priorStart =
    readableText.indexOf("전기");

  const descriptionStart =
    readableText.indexOf(
      "금융수익 및 금융비용에 대한 기술"
    );

  if (
    currentStart === -1 ||
    priorStart === -1
  ) {
    return Response.json({
      error:
        "당기 또는 전기 데이터를 찾지 못했습니다.",
    });
  }

  const currentText =
    readableText.slice(
      currentStart,
      priorStart
    );

  const priorText =
    readableText.slice(
      priorStart,
      descriptionStart > -1
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

  const rowMap = new Map<
    string,
    {
      category: string;
      account: string;
      current_amount:
        | number
        | null;
      prior_amount:
        | number
        | null;
    }
  >();

  for (const row of currentRows) {
    const mapKey =
      `${row.category}::${row.account}`;

    rowMap.set(mapKey, {
      category: row.category,
      account: row.account,
      current_amount: row.amount,
      prior_amount: null,
    });
  }

  for (const row of priorRows) {
    const mapKey =
      `${row.category}::${row.account}`;

    const existing =
      rowMap.get(mapKey);

    if (existing) {
      existing.prior_amount =
        row.amount;
    } else {
      rowMap.set(mapKey, {
        category: row.category,
        account: row.account,
        current_amount: null,
        prior_amount: row.amount,
      });
    }
  }

  const description =
    descriptionStart > -1
      ? readableText
          .slice(
            descriptionStart
          )
          .replace(
            "금융수익 및 금융비용에 대한 기술",
            ""
          )
          .trim()
      : null;

  const financialData =
    Array.from(
      rowMap.values()
    ).map((row) => ({
      ...row,

      note_number: "24",

      ...addIfrs18ReviewInfo(
        row.account
      ),
    }));

  return Response.json({
    company: "삼성전자",
    year: "2025",

    statement_type: "연결",

    note_number: "24",

    note_title:
      "금융수익 및 금융비용",

    unit: "백만원",

    financial_data:
      financialData,

    description,
  });
}