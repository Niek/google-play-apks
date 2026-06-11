export interface PlayApp {
  packageName: string;
  name: string;
  developer: string;
  iconUrl: string;
  versionName: string;
  updatedOn: string;
  downloadLabel: string;
  installs: number;
  rating: number;
  ratingLabel: string;
  price: string;
  category: string;
  shortDescription: string;
  descriptionHtml: string;
  changesHtml: string;
  playUrl: string;
}

export type PlayCountry = (typeof PLAY_COUNTRIES)[number]["code"];

export const PLAY_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "NL", name: "Netherlands" },
  { code: "FR", name: "France" },
  { code: "BE", name: "Belgium" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
] as const;

export const DEFAULT_COUNTRY: PlayCountry = "US";

const PLAY_ORIGIN = "https://play.google.com";
const PLAY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const METADATA_TOKEN =
  "null,null,[[1,9,10,11,13,14,19,20,38,43,47,49,52,58,59,63,69,70,73,74,75,78,79,80,91,92,95,96,97,100,101,103,106,112,119,129,137,139,141,145,146,151,155]],[[[1,null,1],null,[[[]]],null,null,null,null,[null,2],null,null,null,null,null,null,null,null,null,null,null,null,null,null,[1]],[null,[[[]]],null,null,[1]],[null,[[[]]],null,[1]],[null,[[[]]]],null,null,null,null,[[[[]]]],[[[[]]]]],null";

export function normalizeCountry(country: string | null): PlayCountry {
  const normalized = (country ?? "").toUpperCase();
  return PLAY_COUNTRIES.some((item) => item.code === normalized)
    ? (normalized as PlayCountry)
    : DEFAULT_COUNTRY;
}

export async function searchApps(query: string, country: PlayCountry): Promise<PlayApp[]> {
  const packageNames = await searchPackageNames(query, country);
  return getApps(packageNames.slice(0, 12), country);
}

export async function getApp(packageName: string, country: PlayCountry): Promise<PlayApp | null> {
  const apps = await getApps([packageName], country);
  return apps.at(0) ?? null;
}

async function searchPackageNames(query: string, country: PlayCountry): Promise<string[]> {
  const url = new URL("/store/search", PLAY_ORIGIN);
  url.searchParams.set("q", query);
  url.searchParams.set("c", "apps");
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", country);

  const response = await fetch(url, {
    headers: {
      "user-agent": PLAY_USER_AGENT,
      accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`Google Play search failed with HTTP ${response.status}`);
  }

  const html = await readTextWithLimit(response, 2_500_000);
  const ids = new Set<string>();
  for (const match of html.matchAll(/\/store\/apps\/details\?id=([A-Za-z0-9._]+)/g)) {
    ids.add(match[1]);
    if (ids.size >= 24) break;
  }
  return [...ids];
}

async function getApps(packageNames: string[], country: PlayCountry): Promise<PlayApp[]> {
  if (packageNames.length === 0) return [];

  const responseText = await batchExecute(packageNames.map(metadataRequest), country);
  const frames = wrapRpcResponse(responseText);
  const metadata = frames.MetadataBuilder ?? {};
  return packageNames
    .map((packageName) => {
      const payload = metadata[packageName];
      if (!payload) return null;
      return buildApp(packageName, payload, country);
    })
    .filter((app): app is PlayApp => app !== null && app.name.length > 0);
}

async function batchExecute(requests: string[], country: PlayCountry): Promise<string> {
  const url = new URL("/_/PlayStoreUi/data/batchexecute", PLAY_ORIGIN);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", country);

  const body = `f.req=[[${requests.map(encodeURIComponent).join(",")}]]`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      origin: PLAY_ORIGIN,
      "user-agent": PLAY_USER_AGENT,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google Play RPC failed with HTTP ${response.status}`);
  }
  return readTextWithLimit(response, 4_000_000);
}

function metadataRequest(packageName: string): string {
  return JSON.stringify([
    "Ws7gDc",
    `[${METADATA_TOKEN},[[${JSON.stringify(packageName)},7]]]`,
    null,
    `MetadataBuilder@${packageName}`,
  ]);
}

function wrapRpcResponse(input: string): Record<string, Record<string, unknown[]>> {
  const result: Record<string, Record<string, unknown[]>> = {};

  for (const line of input.split(/\r?\n/)) {
    if (!line.startsWith("[[\"wrb.fr")) continue;
    for (const frame of parseJsonArray(line)) {
      if (digString(frame, 0) !== "wrb.fr") continue;

      const tag = digString(frame, 6);
      const [type, key] = tag.split("@");
      const rpcData = digString(frame, 2);
      if (!type || !key || !rpcData) continue;

      result[type] ??= {};
      result[type][key] = parseJsonArray(rpcData);
    }
  }

  return result;
}

function buildApp(packageName: string, payload: unknown[], country: PlayCountry): PlayApp | null {
  const appInfo = digArray(payload, 1, 2);
  if (appInfo.length === 0) return null;

  const offers = digArray(appInfo, 57, 0, 0, 0, 0);
  const price = digString(offers, 1, 0, 2);

  return {
    packageName,
    name: digString(appInfo, 0, 0),
    developer: digString(appInfo, 68, 0),
    iconUrl: digString(appInfo, 95, 0, 3, 2),
    versionName: digString(appInfo, 140, 0, 0, 0),
    updatedOn: digString(appInfo, 145, 0, 0),
    downloadLabel: digString(appInfo, 13, 3),
    installs: digNumber(appInfo, 13, 1),
    rating: digNumber(appInfo, 51, 0, 1),
    ratingLabel: digString(appInfo, 51, 0, 0),
    price: price || "Free",
    category: digString(appInfo, 79, 0, 0, 0),
    shortDescription: digString(appInfo, 73, 0, 1),
    descriptionHtml: digString(appInfo, 72, 0, 1),
    changesHtml: digString(appInfo, 144, 1, 1),
    playUrl: `${PLAY_ORIGIN}/store/apps/details?id=${encodeURIComponent(packageName)}&hl=en&gl=${country}`,
  };
}

async function readTextWithLimit(response: Response, limitBytes: number): Promise<string> {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel();
        throw new Error(`Response exceeded ${limitBytes} byte limit`);
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJsonArray(input: string): unknown[] {
  if (input === "" || input === "null") return [];
  const parsed: unknown = JSON.parse(input);
  return Array.isArray(parsed) ? parsed : [];
}

function dig(value: unknown, ...keys: number[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}

function digArray(value: unknown, ...keys: number[]): unknown[] {
  const item = dig(value, ...keys);
  return Array.isArray(item) ? item : [];
}

function digString(value: unknown, ...keys: number[]): string {
  const item = dig(value, ...keys);
  return typeof item === "string" ? item : "";
}

function digNumber(value: unknown, ...keys: number[]): number {
  const item = dig(value, ...keys);
  return typeof item === "number" && Number.isFinite(item) ? item : 0;
}
