const DEFAULT_API_BASE = "https://api.jgrants-portal.go.jp/exp/v1/public";
const DEFAULT_PUBLIC_BASE = "https://www.jgrants-portal.go.jp/subsidy";
const USER_AGENT = "subsidy-watch/1.0 (+https://github.com/)";

export const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(url, { delayMs = 250, timeoutMs = 20_000 } = {}) {
  await delay(delayMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.result)) {
      throw new Error("jGrants APIのレスポンス形式が不正です");
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSubsidiesByKeyword(
  keyword,
  { apiBase = DEFAULT_API_BASE } = {}
) {
  const url = new URL(`${apiBase}/subsidies`);
  url.search = new URLSearchParams({
    keyword,
    sort: "created_date",
    order: "DESC",
    acceptance: "1"
  }).toString();
  return requestJson(url);
}

export async function fetchSubsidyDetail(
  id,
  { apiBase = DEFAULT_API_BASE } = {}
) {
  const payload = await requestJson(
    `${apiBase}/subsidies/id/${encodeURIComponent(id)}`
  );
  return payload.result[0] ?? null;
}

export function buildPublicUrl(id, publicBase = DEFAULT_PUBLIC_BASE) {
  return `${publicBase.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
}
