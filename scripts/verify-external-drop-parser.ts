import assert from "node:assert/strict";

import { parseExternalDropData } from "../apps/web/src/components";

function createDataTransfer(payload: Record<string, string>) {
  return {
    getData(type: string) {
      return payload[type] ?? "";
    }
  } as Pick<DataTransfer, "getData">;
}

const cases = [
  {
    name: "html-text-and-url",
    payload: createDataTransfer({
      "text/html": '<a href="https://www.naver.com">네이버</a>'
    }),
    expected: {
      displayName: "네이버",
      url: "https://www.naver.com/"
    }
  },
  {
    name: "uri-list-only",
    payload: createDataTransfer({
      "text/uri-list": "https://www.naver.com"
    }),
    expected: {
      displayName: "naver.com",
      url: "https://www.naver.com/"
    }
  },
  {
    name: "plain-name-with-uri-list",
    payload: createDataTransfer({
      "text/plain": "네이버",
      "text/uri-list": "https://www.naver.com"
    }),
    expected: {
      displayName: "네이버",
      url: "https://www.naver.com/"
    }
  },
  {
    name: "html-title-fallback",
    payload: createDataTransfer({
      "text/html": '<a href="https://example.com" title="Example Title"></a>'
    }),
    expected: {
      displayName: "Example Title",
      url: "https://example.com/"
    }
  },
  {
    name: "webkit-public-url-name",
    payload: createDataTransfer({
      "public.url": "https://www.naver.com",
      "public.url-name": "네이버"
    }),
    expected: {
      displayName: "네이버",
      url: "https://www.naver.com/"
    }
  },
  {
    name: "mozilla-url-with-title",
    payload: createDataTransfer({
      "text/x-moz-url": "https://www.naver.com\n네이버"
    }),
    expected: {
      displayName: "네이버",
      url: "https://www.naver.com/"
    }
  },
  {
    name: "generic-text-alias-with-public-url",
    payload: createDataTransfer({
      text: "네이버",
      "public.url": "https://www.naver.com"
    }),
    expected: {
      displayName: "네이버",
      url: "https://www.naver.com/"
    }
  },
  {
    name: "plain-text-alias-with-uri",
    payload: createDataTransfer({
      "public.utf8-plain-text": "네이버",
      "text/uri-list": "https://www.naver.com"
    }),
    expected: {
      displayName: "네이버",
      url: "https://www.naver.com/"
    }
  },
  {
    name: "invalid-url",
    payload: createDataTransfer({
      "text/plain": "not a url"
    }),
    expected: null
  }
];

for (const testCase of cases) {
  const result = parseExternalDropData(testCase.payload);
  assert.deepEqual(result, testCase.expected, testCase.name);
  console.log(`${testCase.name}: ok`);
}
