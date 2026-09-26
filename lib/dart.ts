import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

export class DartError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
type CacheEntry = { expires: number; value: Promise<unknown> };
const globalCache = globalThis as typeof globalThis & { dartCache?: Map<string, CacheEntry> };
const cache = globalCache.dartCache ??= new Map();

/** Bounded, in-flight deduplicated cache; rejected requests are never retained. */
export async function cached<T>(key: string, loader: () => Promise<T> | T, ttl = 30 * 60_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  cache.delete(key);
  for (const [k, entry] of cache) if (entry.expires <= Date.now()) cache.delete(k);
  while (cache.size >= 40) cache.delete(cache.keys().next().value!);
  const value = Promise.resolve().then(loader);
  cache.set(key, { expires: Date.now() + ttl, value });
  try { return await value; } catch (error) { cache.delete(key); throw error; }
}

function apiKey() {
  const key = process.env.DART_API_KEY?.trim();
  if (!key) throw new DartError("DART_API_KEY가 없습니다. 서버 환경변수에 인증키를 설정한 뒤 다시 배포하거나 서버를 재시작하세요.", 503);
  return key;
}

function downloadError(error: unknown): DartError {
  if (error instanceof DartError) return error;
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new DartError("DART 자료 다운로드 시간이 초과됐습니다. 잠시 후 다시 시도하세요. 반복되면 배포 서버의 서울(icn1) 리전 설정을 확인해주세요.", 504);
  }
  return new DartError("DART 자료 다운로드가 중단됐습니다. 잠시 후 다시 시도하세요.");
}

function checkDartStatus(status: string) {
  if (status === "000") return;
  const messages: Record<string, string> = {
    "010": "DART 인증키를 확인해주세요.", "011": "사용할 수 없는 DART 인증키입니다.",
    "012": "DART에서 배포 서버의 IP 접근을 허용하지 않습니다. 인증키의 사용 IP 설정을 확인해주세요.",
    "013": "해당 조건의 공시 또는 재무제표가 없습니다.", "014": "DART 원문 파일이 존재하지 않습니다.",
    "020": "DART 조회 한도를 초과했습니다. 나중에 다시 시도하세요.",
    "800": "DART 시스템 점검 중입니다. 나중에 다시 시도하세요.",
    "901": "DART 인증키의 사용자 정보 보유기간이 만료되었습니다. OpenDART에서 인증키 상태를 확인해주세요.",
  };
  // Use only local messages, never upstream text that could contain credentials.
  throw new DartError(messages[status] ?? "DART 데이터를 불러오지 못했습니다.", ["013", "014"].includes(status) ? 404 : 502);
}

export async function dartFetch(endpoint: string, params: Record<string, string>) {
  const query = new URLSearchParams({ ...params, crtfc_key: apiKey() });
  try {
    const response = await fetch(`https://opendart.fss.or.kr/api/${endpoint}?${query}`, {
      cache: "no-store", signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new DartError("DART 서버 응답에 실패했습니다. 잠시 후 다시 시도하세요.");
    return response;
  } catch (error) {
    // Never expose upstream URLs: they contain the API key.
    throw downloadError(error);
  }
}

export async function dartJson<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  try {
    const data = await (await dartFetch(endpoint, params)).json();
    checkDartStatus(String(data.status));
    return data as T;
  } catch (error) {
    throw downloadError(error);
  }
}

/** The abort signal remains active after headers, including the entire body download. */
export async function dartZipXml(endpoint: string, params: Record<string, string>, preferredFile?: string) {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await (await dartFetch(endpoint, params)).arrayBuffer());
  } catch (error) {
    throw downloadError(error);
  }
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    // DART can return an XML error with HTTP 200 instead of a ZIP file.
    if (buffer.length < 64_000) {
      let status: unknown;
      try { status = new XMLParser({ parseTagValue: false }).parse(buffer.toString("utf8"))?.result?.status; } catch { /* invalid upstream body */ }
      if (typeof status === "string") checkDartStatus(status);
    }
    throw new DartError("DART에서 정상적인 ZIP 자료를 받지 못했습니다. 잠시 후 다시 시도하세요.");
  }
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory && /\.xml$/i.test(e.entryName));
    const entry = entries.find(e => e.entryName === preferredFile) ?? entries.sort((a, b) => b.header.size - a.header.size)[0];
    if (!entry) throw new Error("missing XML");
    return entry.getData().toString("utf8");
  } catch {
    throw new DartError("DART ZIP/XML 자료가 누락되거나 손상되었습니다. 잠시 후 다시 시도하세요.");
  }
}

export type DartReport = { rcept_no: string; report_nm: string; rcept_dt: string; corp_name: string };
export function validateScope(corpCode: string, year: string, fsDiv: string, receipt?: string | null) {
  if (!/^\d{8}$/.test(corpCode) || !/^\d{4}$/.test(year) || +year < 2015 || +year > new Date().getFullYear() || !["CFS", "OFS"].includes(fsDiv)) {
    throw new DartError("회사 고유번호, 사업연도(2015년 이후), 연결/별도 조건을 확인해주세요.", 400);
  }
  if (receipt && !/^\d{14}$/.test(receipt)) throw new DartError("접수번호 형식이 올바르지 않습니다.", 400);
}

export async function getAnnualReport(corpCode: string, year: string, receipt?: string | null) {
  validateScope(corpCode, year, "CFS", receipt);
  const reports = await cached(`reports:${corpCode}:${year}`, async () => {
    const list: DartReport[] = [];
    for (let page = 1; page <= 20; page++) {
      const data = await dartJson<{ list: DartReport[]; total_page: number }>("list.json", {
        corp_code: corpCode, bgn_de: `${year}0101`, end_de: new Date().toISOString().slice(0, 10).replaceAll("-", ""),
        last_reprt_at: "N", pblntf_detail_ty: "A001", sort: "date", sort_mth: "desc", page_count: "100", page_no: String(page),
      });
      list.push(...data.list);
      if (page >= data.total_page) break;
    }
    return list;
  }, 60_000);
  const report = reports.find(r => r.report_nm.includes(`사업보고서 (${year}.`) && (!receipt || r.rcept_no === receipt));
  if (!report) throw new DartError("해당 사업연도와 접수번호의 사업보고서를 찾지 못했습니다. 분석을 다시 실행해주세요.", 404);
  return report;
}

export function reportLineage(report: DartReport) {
  return { report_name: report.report_nm, rcept_no: report.rcept_no, rcept_date: report.rcept_dt };
}

export async function getDocumentXml(receipt: string) {
  if (!/^\d{14}$/.test(receipt)) throw new DartError("접수번호 형식이 올바르지 않습니다.", 400);
  return cached(`xml:${receipt}`, () => dartZipXml("document.xml", { rcept_no: receipt }, `${receipt}.xml`));
}

export function apiError(error: unknown) {
  return Response.json({ error: error instanceof DartError ? error.message : "자료 처리 중 오류가 발생했습니다. 조건을 확인하고 다시 시도하세요." }, { status: error instanceof DartError ? error.status : 500 });
}
