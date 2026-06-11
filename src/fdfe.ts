interface NativeDeliveryDetails {
  versionCode: number;
  versionName: string;
  offerType: number;
}

export interface PlayFile {
  name: string;
  url: string;
  type: "base" | "split" | "obb" | "patch";
  size: number;
  sha1: string;
  sha256: string;
}

export interface DeliveryManifest {
  packageName: string;
  versionCode: number;
  versionName: string;
  offerType: number;
  files: PlayFile[];
}

interface PlayAuth {
  authToken: string;
  gsfId: string;
  deviceConfigToken: string;
  deviceCheckInConsistencyToken: string;
  dfeCookie: string;
  locale: string;
  userAgent: string;
  mccMnc: string;
  encodedTargets: string;
  phenotype: string;
}

interface DeliveryOptions {
  versionCode?: number;
  offerType?: number;
  certificateHash?: string;
}

interface ProtoField {
  field: number;
  wire: number;
  value: bigint | Uint8Array;
}

const PLAY_BASE = "https://android.clients.google.com";
const AUTH_CACHE_KEY = "aurora-auth";
const AUTH_CACHE_TTL_SECONDS = 3600;

class PlayAuthExpiredError extends Error {}
const AURORA_AUTH_URL = "https://auroraoss.com/api/auth";
const AURORA_USER_AGENT = "com.aurora.store-4.8.3-75";
const LEGACY_USER_AGENT =
  "Android-Finsky/29.2.15-21 [0] [PR] 426536134 (api=3,versionCode=82921510,sdk=25)";
const DEVICE_PROPERTIES: Record<string, string> = {
  "UserReadableName": "Google Pixel 9a",
  "Build.HARDWARE": "tegu",
  "Build.RADIO": "g5300t-241101-241226-B-12850354,g5300t-241101-241226-B-12850354",
  "Build.BOOTLOADER": "tegu-16.0-13238451",
  "Build.FINGERPRINT": "google/tegu/tegu:15/BD4A.250405.003/13238919:user/release-keys",
  "Build.BRAND": "google",
  "Build.DEVICE": "tegu",
  "Build.VERSION.SDK_INT": "35",
  "Build.VERSION.RELEASE": "15",
  "Build.MODEL": "Pixel 9a",
  "Build.MANUFACTURER": "Google",
  "Build.PRODUCT": "tegu",
  "Build.ID": "BD4A.250405.003",
  "TouchScreen": "3",
  "Keyboard": "1",
  "Navigation": "1",
  "ScreenLayout": "2",
  "HasHardKeyboard": "false",
  "HasFiveWayNavigation": "false",
  "GL.Version": "196610",
  "GSF.version": "251333035",
  "Vending.version": "84582130",
  "Vending.versionString": "45.8.21-31 [0] [PR] 747433787",
  "Screen.Density": "420",
  "Screen.Width": "1080",
  "Screen.Height": "2424",
  "Platforms": "arm64-v8a",
  "SharedLibraries": "com.google.android.gms",
  "Features": "android.hardware.touchscreen,android.hardware.wifi,android.hardware.location,android.hardware.camera,com.google.android.feature.GOOGLE_EXPERIENCE",
  "Locales": "en_US",
  "CellOperator": "310",
  "SimOperator": "38",
  "Roaming": "mobile-notroaming",
  "Client": "android-google",
  "TimeZone": "UTC-10",
  "GL.Extensions": "",
};

async function getNativeDetailsWithAuth(
  auth: PlayAuth,
  packageName: string,
): Promise<NativeDeliveryDetails> {
  const bytes = await fdfeFetch("GET", "/fdfe/details", auth, { doc: packageName });
  const payload = unwrapPayload(bytes);
  const details = parseMessage(requiredBytes(payload, 2, "detailsResponse"));
  const item = parseMessage(requiredBytes(details, 4, "item"));
  return parseDetailsItem(packageName, item);
}

export async function getDeliveryManifest(
  packageName: string,
  options: DeliveryOptions = {},
  authCache?: KVNamespace,
): Promise<DeliveryManifest> {
  const cachedAuth = await readCachedAuth(authCache);
  if (cachedAuth) {
    try {
      return await fetchManifestWithAuth(cachedAuth, packageName, options);
    } catch (error) {
      if (!(error instanceof PlayAuthExpiredError)) throw error;
    }
  }

  const auth = await getAuroraAuth();
  await writeCachedAuth(authCache, auth);
  return fetchManifestWithAuth(auth, packageName, options);
}

async function fetchManifestWithAuth(
  auth: PlayAuth,
  packageName: string,
  options: DeliveryOptions,
): Promise<DeliveryManifest> {
  const nativeDetails = await getNativeDetailsWithAuth(auth, packageName);
  const versionCode = options.versionCode ?? nativeDetails.versionCode;
  const versionName = versionCode === nativeDetails.versionCode ? nativeDetails.versionName : "";
  const offerType = options.offerType ?? nativeDetails.offerType;

  const deliveryToken = await getDeliveryToken(auth, packageName, versionCode, offerType, options.certificateHash);
  const deliveryBytes = await getDeliveryBytes(auth, packageName, versionCode, offerType, deliveryToken, options.certificateHash);
  const files = parseDeliveryFiles(packageName, versionCode, deliveryBytes);

  if (files.length === 0) {
    throw new Error("Google Play delivery response did not contain APK URLs");
  }

  return { packageName, versionCode, versionName, offerType, files };
}

async function getDeliveryToken(
  auth: PlayAuth,
  packageName: string,
  versionCode: number,
  offerType: number,
  certificateHash?: string,
): Promise<string> {
  const bytes = await fdfeFetch("POST", "/fdfe/purchase", auth, deliveryParams(packageName, versionCode, offerType, certificateHash));
  const payload = unwrapPayload(bytes);
  const buyResponse = parseMessage(requiredBytes(payload, 4, "buyResponse"));
  const token = firstString(buyResponse, 55);
  if (!token) throw new Error("Google Play purchase response did not contain a delivery token");
  return token;
}

async function getDeliveryBytes(
  auth: PlayAuth,
  packageName: string,
  versionCode: number,
  offerType: number,
  deliveryToken: string,
  certificateHash?: string,
): Promise<Uint8Array> {
  return fdfeFetch("GET", "/fdfe/delivery", auth, {
    ...deliveryParams(packageName, versionCode, offerType, certificateHash),
    dtok: deliveryToken,
  });
}

function deliveryParams(packageName: string, versionCode: number, offerType: number, certificateHash?: string): Record<string, string> {
  const params: Record<string, string> = {
    doc: packageName,
    vc: String(versionCode),
    ot: String(offerType),
  };
  if (certificateHash) params.ch = certificateHash;
  return params;
}

function parseDetailsItem(packageName: string, item: ProtoField[]): NativeDeliveryDetails {
  const documentDetails = parseMessage(requiredBytes(item, 13, "documentDetails"));
  const appDetails = parseMessage(requiredBytes(documentDetails, 1, "appDetails"));
  const offer = allBytes(item, 8).at(0);
  const offerFields = offer ? parseMessage(offer) : [];

  const versionCode = firstVarintNumber(appDetails, 3);
  if (!versionCode) {
    throw new Error(`Google Play details did not include a versionCode for ${packageName}`);
  }

  return {
    versionCode,
    versionName: firstString(appDetails, 4),
    offerType: firstVarintNumber(offerFields, 8) || 1,
  };
}

function parseDeliveryFiles(packageName: string, versionCode: number, bytes: Uint8Array): PlayFile[] {
  const payload = unwrapPayload(bytes);
  const delivery = parseMessage(requiredBytes(payload, 21, "deliveryResponse"));
  const status = firstVarintNumber(delivery, 1);
  if (status && status !== 1) {
    throw new Error(`Google Play delivery failed with status ${status}`);
  }

  const appDataBytes = firstBytes(delivery, 2);
  if (!appDataBytes) return [];

  const appData = parseMessage(appDataBytes);
  const files: PlayFile[] = [];
  addFile(files, {
    name: "base.apk",
    url: firstString(appData, 3) || firstString(appData, 13),
    type: "base",
    size: firstVarintNumber(appData, 1) || firstVarintNumber(appData, 14),
    sha1: firstString(appData, 2),
    sha256: firstString(appData, 19),
  });

  for (const fileBytes of allBytes(appData, 4)) {
    const fields = parseMessage(fileBytes);
    const fileType = firstVarintNumber(fields, 1);
    const type = fileType === 0 ? "obb" : "patch";
    const name = `${type === "obb" ? "main" : "patch"}.${versionCode}.${packageName}.obb`;
    addFile(files, {
      name,
      url: firstString(fields, 4) || firstString(fields, 7),
      type,
      size: firstVarintNumber(fields, 3) || firstVarintNumber(fields, 6),
      sha1: firstString(fields, 8),
      sha256: "",
    });
  }

  let splitIndex = 0;
  for (const splitBytes of allBytes(appData, 15)) {
    splitIndex += 1;
    const fields = parseMessage(splitBytes);
    const splitName = firstString(fields, 1);
    addFile(files, {
      name: splitName ? `${splitName}.apk` : `split-${splitIndex}.apk`,
      url: firstString(fields, 5) || firstString(fields, 6),
      type: "split",
      size: firstVarintNumber(fields, 2) || firstVarintNumber(fields, 3),
      sha1: firstString(fields, 4),
      sha256: firstString(fields, 9),
    });
  }

  return files;
}

function addFile(files: PlayFile[], file: PlayFile): void {
  if (!file.url) return;
  files.push(file);
}

async function fdfeFetch(
  method: "GET" | "POST",
  path: string,
  auth: PlayAuth,
  params: Record<string, string>,
): Promise<Uint8Array> {
  const url = new URL(path, PLAY_BASE);
  const headers = playHeaders(auth);
  const init: RequestInit = { method, headers };

  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  } else {
    headers.set("content-type", "application/x-www-form-urlencoded");
    init.body = new URLSearchParams(params);
  }

  const response = await fetch(url, init);
  const bytes = await readBytesWithLimit(response, 5_000_000);
  if (response.status === 401) {
    throw new PlayAuthExpiredError(`Google Play ${path} rejected the auth token with HTTP 401`);
  }
  if (!response.ok) {
    throw new Error(`Google Play ${path} failed with HTTP ${response.status}: ${decodeSnippet(bytes)}`);
  }
  return bytes;
}

function playHeaders(auth: PlayAuth): Headers {
  const headers = new Headers({
    authorization: `Bearer ${auth.authToken}`,
    "user-agent": auth.userAgent,
    "x-dfe-device-id": auth.gsfId,
    "accept-language": auth.locale.replaceAll("_", "-"),
    "x-dfe-client-id": "am-android-google",
    "x-dfe-network-type": "4",
    "x-dfe-content-filters": "",
    "x-limit-ad-tracking-enabled": "false",
    "x-ad-id": "",
    "x-dfe-userlanguages": auth.locale,
    "x-dfe-request-params": "timeoutMs=4000",
  });
  if (auth.deviceCheckInConsistencyToken) {
    headers.set("x-dfe-device-checkin-consistency-token", auth.deviceCheckInConsistencyToken);
  }
  if (auth.deviceConfigToken) headers.set("x-dfe-device-config-token", auth.deviceConfigToken);
  if (auth.dfeCookie) headers.set("x-dfe-cookie", auth.dfeCookie);
  if (auth.mccMnc) headers.set("x-dfe-mccmnc", auth.mccMnc);
  if (auth.encodedTargets) headers.set("x-dfe-encoded-targets", auth.encodedTargets);
  if (auth.phenotype) headers.set("x-dfe-phenotype", auth.phenotype);
  return headers;
}

async function readCachedAuth(cache: KVNamespace | undefined): Promise<PlayAuth | null> {
  if (!cache) return null;
  try {
    const value: unknown = await cache.get(AUTH_CACHE_KEY, "json");
    const object = objectValue(value);
    return object ? parseAuth(object) : null;
  } catch {
    return null;
  }
}

async function writeCachedAuth(cache: KVNamespace | undefined, auth: PlayAuth): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(AUTH_CACHE_KEY, JSON.stringify(auth), { expirationTtl: AUTH_CACHE_TTL_SECONDS });
  } catch {
    // A failed cache write should not fail the delivery request.
  }
}

async function getAuroraAuth(): Promise<PlayAuth> {
  const response = await fetch(AURORA_AUTH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": AURORA_USER_AGENT,
    },
    body: JSON.stringify(DEVICE_PROPERTIES),
  });
  const bytes = await readBytesWithLimit(response, 1_000_000);
  if (!response.ok) {
    throw new Error(`Aurora anonymous auth failed with HTTP ${response.status}: ${decodeSnippet(bytes)}`);
  }

  return parseAuth(parseJsonObject(new TextDecoder().decode(bytes)));
}

function parseAuth(input: Record<string, unknown>): PlayAuth {
  const deviceInfo = objectValue(input.deviceInfoProvider);
  const properties = objectValue(deviceInfo?.properties);
  const authToken = stringValue(input.authToken) || stringValue(input.auth);
  const gsfId = stringValue(input.gsfId) || stringValue(input.device);

  if (!authToken || !gsfId) {
    throw new Error("Aurora anonymous auth response did not include authToken and gsfId");
  }

  return {
    authToken,
    gsfId,
    deviceConfigToken: stringValue(input.deviceConfigToken),
    deviceCheckInConsistencyToken: stringValue(input.deviceCheckInConsistencyToken),
    dfeCookie: stringValue(input.dfeCookie),
    locale: stringValue(input.locale) || stringValue(deviceInfo?.localeString) || "en_US",
    userAgent: stringValue(input.userAgent) || stringValue(input.userAgentString) || stringValue(deviceInfo?.userAgentString) || userAgentFromProperties(properties) || LEGACY_USER_AGENT,
    mccMnc: stringValue(input.mccMnc) || stringValue(deviceInfo?.mccMnc) || stringValue(properties?.SimOperator),
    encodedTargets: stringValue(input.encodedTargets),
    phenotype: stringValue(input.phenotype),
  };
}

function userAgentFromProperties(properties: Record<string, unknown> | undefined): string {
  if (!properties) return "";
  const vendingVersion = stringValue(properties["Vending.version"]);
  const vendingVersionString = stringValue(properties["Vending.versionString"]);
  if (!vendingVersion || !vendingVersionString) return "";

  const platforms = stringValue(properties.Platforms).split(",").filter(Boolean).join(";");
  const params = [
    "api=3",
    `versionCode=${vendingVersion}`,
    `sdk=${stringValue(properties["Build.VERSION.SDK_INT"])}`,
    `device=${stringValue(properties["Build.DEVICE"])}`,
    `hardware=${stringValue(properties["Build.HARDWARE"])}`,
    `product=${stringValue(properties["Build.PRODUCT"])}`,
    `platformVersionRelease=${stringValue(properties["Build.VERSION.RELEASE"])}`,
    `model=${stringValue(properties["Build.MODEL"])}`,
    `buildId=${stringValue(properties["Build.ID"])}`,
    "isWideScreen=0",
    `supportedAbis=${platforms}`,
  ];
  return `Android-Finsky/${vendingVersionString} (${params.join(",")})`;
}

function unwrapPayload(bytes: Uint8Array): ProtoField[] {
  return parseMessage(requiredBytes(parseMessage(bytes), 1, "payload"));
}

function parseMessage(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    const key = readVarint(bytes, offset);
    offset = key.next;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);

    if (field <= 0) throw new Error("Invalid protobuf field");
    if (wire === 0) {
      const value = readVarint(bytes, offset);
      offset = value.next;
      fields.push({ field, wire, value: value.value });
    } else if (wire === 1) {
      offset += 8;
      fields.push({ field, wire, value: 0n });
    } else if (wire === 2) {
      const length = readVarint(bytes, offset);
      offset = length.next;
      const end = offset + Number(length.value);
      if (end > bytes.byteLength) throw new Error("Invalid protobuf length");
      fields.push({ field, wire, value: bytes.slice(offset, end) });
      offset = end;
    } else if (wire === 5) {
      offset += 4;
      fields.push({ field, wire, value: 0n });
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }

    if (offset > bytes.byteLength) throw new Error("Invalid protobuf offset");
  }

  return fields;
}

function readVarint(bytes: Uint8Array, offset: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  let next = offset;

  while (next < bytes.byteLength) {
    const byte = bytes[next];
    value |= BigInt(byte & 0x7f) << shift;
    next += 1;
    if ((byte & 0x80) === 0) return { value, next };
    shift += 7n;
    if (shift > 70n) throw new Error("Invalid protobuf varint");
  }

  throw new Error("Truncated protobuf varint");
}

function firstBytes(fields: ProtoField[], field: number): Uint8Array | undefined {
  const value = fields.find((item) => item.field === field && item.wire === 2)?.value;
  return value instanceof Uint8Array ? value : undefined;
}

function requiredBytes(fields: ProtoField[], field: number, label: string): Uint8Array {
  const value = firstBytes(fields, field);
  if (!value) throw new Error(`Google Play response did not include ${label}`);
  return value;
}

function allBytes(fields: ProtoField[], field: number): Uint8Array[] {
  return fields
    .filter((item) => item.field === field && item.wire === 2 && item.value instanceof Uint8Array)
    .map((item) => item.value as Uint8Array);
}

function firstString(fields: ProtoField[], field: number): string {
  const bytes = firstBytes(fields, field);
  return bytes ? new TextDecoder().decode(bytes) : "";
}

function firstVarintNumber(fields: ProtoField[], field: number): number {
  const value = fields.find((item) => item.field === field && item.wire === 0)?.value;
  if (typeof value !== "bigint" || value > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
  return Number(value);
}

async function readBytesWithLimit(response: Response, limitBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel();
      throw new Error(`Response exceeded ${limitBytes} byte limit`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeSnippet(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 300)).replace(/\s+/g, " ").trim();
}

function parseJsonObject(input: string): Record<string, unknown> {
  const value: unknown = JSON.parse(input);
  const object = objectValue(value);
  if (!object) throw new Error("Aurora anonymous auth response was not a JSON object");
  return object;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
