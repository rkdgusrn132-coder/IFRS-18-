import { test, expect } from 'bun:test';
import AdmZip from 'adm-zip';
import { GET } from '../app/api/company-search/route.ts';
import { apiError, dartZipXml, dartJson } from '../lib/dart.ts';

// Fixtures contain no real credentials. Restore the fetch and environment after each test.
async function withFetch(fetcher, run) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DART_API_KEY;
  process.env.DART_API_KEY = 'download-test-placeholder';
  globalThis.fetch = fetcher;
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DART_API_KEY;
    else process.env.DART_API_KEY = originalKey;
  }
}
const request = () => new Request('http://localhost/api/company-search?q=000660');

test('body timeout returns actionable 504 and a later company search retries successfully', async () => {
  let calls = 0;
  const zip = new AdmZip();
  zip.addFile('CORPCODE.xml', Buffer.from('<result><list><corp_code>00164779</corp_code><corp_name>SK하이닉스</corp_name><stock_code>000660</stock_code></list></result>'));
  await withFetch(async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([80, 75, 3, 4]));
      controller.error(new DOMException('download-test-placeholder in upstream URL', 'TimeoutError'));
    } }));
    return new Response(zip.toBuffer());
  }, async () => {
    const failed = await GET(request());
    expect(failed.status).toBe(504);
    const message = (await failed.json()).error;
    expect(message).toContain('다운로드 시간이 초과');
    expect(message).not.toContain('download-test-placeholder');
    const success = await GET(request());
    expect(success.status).toBe(200);
    expect((await success.json()).results[0]).toMatchObject({corp_code: '00164779', stock_code: '000660'});
    await GET(request());
    expect(calls).toBe(2);
  });
});

test('HTTP 200 XML authentication and IP failures are not treated as ZIPs', async () => {
  for (const [status, expected] of [['010', '인증키'], ['012', 'IP 접근'], ['020', '조회 한도']]) {
    await withFetch(async () => new Response(`<result><status>${status}</status><message>download-test-placeholder</message></result>`), async () => {
      let caught;
      try { await dartZipXml('corpCode.xml', {}); } catch (error) { caught = error; }
      const response = apiError(caught);
      expect(response.status).toBe(502);
      const message = (await response.json()).error;
      expect(message).toContain(expected);
      expect(message).not.toContain('download-test-placeholder');
    });
  }
});

test('truncated ZIPs and unexpected HTML return safe upstream errors', async () => {
  for (const body of [Buffer.from([80, 75, 3, 4, 0]), '<html>download-test-placeholder</html>']) {
    await withFetch(async () => new Response(body), async () => {
      await expect(dartZipXml('document.xml', {})).rejects.toThrow('DART');
    });
  }
});

test('JSON body abort is also handled after response headers arrive', async () => {
  await withFetch(async () => new Response(new ReadableStream({ start(controller) {
    controller.error(new DOMException('download-test-placeholder', 'AbortError'));
  } })), async () => {
    try { await dartJson('list.json', {}); throw Error('expected abort'); }
    catch (error) { expect(error.status).toBe(504); expect(error.message).not.toContain('download-test-placeholder'); }
  });
});

test('document ZIP selects the receipt XML rather than an unrelated larger entry', async () => {
  const zip = new AdmZip();
  zip.addFile('20260317000635.xml', Buffer.from('<DOCUMENT>expected</DOCUMENT>'));
  zip.addFile('other.xml', Buffer.from('<DOCUMENT>unrelated longer document</DOCUMENT>'));
  await withFetch(async () => new Response(zip.toBuffer()), async () => {
    expect(await dartZipXml('document.xml', {}, '20260317000635.xml')).toBe('<DOCUMENT>expected</DOCUMENT>');
  });
});
