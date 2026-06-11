import {
  getApp,
  normalizeCountry,
  PLAY_COUNTRIES,
  searchApps,
  type PlayApp,
  type PlayCountry,
} from "./play";
import {
  getDeliveryManifest,
  type DeliveryManifest,
} from "./fdfe";

const BULMA_CSS = "https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.min.css";
const GITHUB_URL = "https://github.com/Niek/google-play-apks";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const country = normalizeCountry(url.searchParams.get("gl"));

    try {
      if (url.pathname === "/api/search") {
        return json(await searchApps(url.searchParams.get("q")?.trim() ?? "", country));
      }

      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      const apiAppMatch = url.pathname.match(/^\/api\/app\/([^/]+)$/);
      if (apiAppMatch) {
        const app = await getApp(decodeURIComponent(apiAppMatch[1]), country);
        return app ? json(app) : notFound("App not found");
      }

      const apiDownloadMatch = url.pathname.match(/^\/api\/download\/([^/]+)$/);
      if (apiDownloadMatch) {
        const packageName = decodeURIComponent(apiDownloadMatch[1]);
        try {
          return json(await getDeliveryManifest(packageName, deliveryOptions(url)));
        } catch (error) {
          return json({ error: errorMessage(error) }, 502);
        }
      }

      const appMatch = url.pathname.match(/^\/app\/([^/]+)$/);
      if (appMatch) {
        const app = await getApp(decodeURIComponent(appMatch[1]), country);
        return html(app ? appPage(app, country) : shell("Not found", notFoundView()));
      }

      const downloadMatch = url.pathname.match(/^\/download\/([^/]+)$/);
      if (downloadMatch) {
        const packageName = decodeURIComponent(downloadMatch[1]);
        const app = await getApp(packageName, country);
        let manifest: DeliveryManifest | null = null;
        let error = "";
        const shouldFetch = url.searchParams.get("fetch") === "1" || parsePositiveInteger(url.searchParams.get("vc")) !== undefined;
        if (shouldFetch) {
          try {
            manifest = await getDeliveryManifest(packageName, deliveryOptions(url));
          } catch (caught) {
            error = errorMessage(caught);
          }
        }
        return html(shell("APK delivery", downloadView(packageName, app, country, {
          versionCode: parsePositiveInteger(url.searchParams.get("vc")),
          manifest,
          error,
        })));
      }

      const query = url.searchParams.get("q")?.trim() ?? "";
      const results = query ? await searchApps(query, country) : [];
      return html(shell("Google Play APKs", homeView(query, country, results)));
    } catch (error) {
      return html(shell("Error", errorView(error)), 502);
    }
  },
} satisfies ExportedHandler<Env>;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${BULMA_CSS}">
</head>
<body>
  <section class="section">
    <div class="container">
      ${body}
    </div>
  </section>
  <footer class="footer">
    <div class="content has-text-centered is-size-7">
      <a href="${GITHUB_URL}">Niek/google-play-apks</a>
    </div>
  </footer>
  <script>
    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.dataset.loadingForm === undefined) return;
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      if (button instanceof HTMLButtonElement) {
        button.disabled = true;
        button.classList.add("is-loading");
      }
      requestAnimationFrame(() => form.submit());
    });
  </script>
</body>
</html>`;
}

function homeView(query: string, country: PlayCountry, apps: PlayApp[]): string {
  return `
    <h1 class="title">Google Play APKs</h1>
    <form class="field has-addons" method="get" action="/">
      <div class="control is-expanded">
        <input class="input" type="search" name="q" value="${escapeAttribute(query)}" placeholder="Search Google Play apps" autofocus>
      </div>
      <div class="control">
        <div class="select">
          <select name="gl" aria-label="Google Play country">
            ${countryOptions(country)}
          </select>
        </div>
      </div>
      <div class="control">
        <button class="button is-link" type="submit">Search</button>
      </div>
    </form>
    ${query ? resultsView(query, country, apps) : `<p class="has-text-grey">Search for an app to start.</p>`}
  `;
}

function resultsView(query: string, country: PlayCountry, apps: PlayApp[]): string {
  if (apps.length === 0) {
    return `<p>No apps found for <strong>${escapeHtml(query)}</strong>.</p>`;
  }

  return `
    <h2 class="subtitle">Results for <strong>${escapeHtml(query)}</strong> in ${escapeHtml(country)}</h2>
    <div class="fixed-grid has-1-cols">
      <div class="grid">
        ${apps.map((app) => resultCard(app, country)).join("")}
      </div>
    </div>
  `;
}

function resultCard(app: PlayApp, country: PlayCountry): string {
  return `
    <article class="cell box">
      <div class="media">
        <div class="media-left">
          ${app.iconUrl ? `<figure class="image is-64x64"><img src="${escapeAttribute(app.iconUrl)}" alt=""></figure>` : ""}
        </div>
        <div class="media-content">
          <p class="title is-5"><a href="/app/${encodeURIComponent(app.packageName)}?gl=${country}">${escapeHtml(app.name)}</a></p>
          <p class="subtitle is-6">${escapeHtml(app.developer)} · ${escapeHtml(app.packageName)}</p>
          <p>${escapeHtml(plainTextFromPlayHtml(app.shortDescription))}</p>
          <p class="is-size-7 has-text-grey">
            ${escapeHtml(app.versionName || "unknown version")} · ${escapeHtml(app.updatedOn || "unknown date")}
          </p>
        </div>
      </div>
    </article>
  `;
}

function appPage(app: PlayApp, country: PlayCountry): string {
  return shell(app.name, `
    <p><a href="/?gl=${country}">Back to search</a></p>
    <div class="media">
      <div class="media-left">
        ${app.iconUrl ? `<figure class="image is-96x96"><img src="${escapeAttribute(app.iconUrl)}" alt=""></figure>` : ""}
      </div>
      <div class="media-content">
        <h1 class="title">${escapeHtml(app.name)}</h1>
        <p class="subtitle">${escapeHtml(app.developer)} · <code>${escapeHtml(app.packageName)}</code></p>
      </div>
    </div>

    <div class="columns mt-5">
      <div class="column">
        <table class="table is-fullwidth">
          <tbody>
            <tr><th>Latest version</th><td>${escapeHtml(app.versionName || "Unknown")}</td></tr>
            <tr><th>Updated on</th><td>${escapeHtml(app.updatedOn || "Unknown")}</td></tr>
            <tr><th>Installs</th><td>${escapeHtml(app.downloadLabel || formatNumber(app.installs))}</td></tr>
            <tr><th>Rating</th><td>${escapeHtml(app.ratingLabel || app.rating.toFixed(1))}</td></tr>
            <tr><th>Price</th><td>${escapeHtml(app.price)}</td></tr>
            <tr><th>Category</th><td>${escapeHtml(app.category || "Unknown")}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    ${app.changesHtml ? `<h2 class="title is-4">What's new</h2><div class="content">${sanitizePlayHtml(app.changesHtml)}</div>` : ""}

    <h2 class="title is-4">APK downloads</h2>
    ${downloadNotice(app, country)}

    <h2 class="title is-4">Description</h2>
    <div class="content">${sanitizePlayHtml(app.descriptionHtml)}</div>
  `);
}

function downloadNotice(app: PlayApp, country: PlayCountry): string {
  return `
    ${downloadForm(app.packageName, country)}
    <div class="buttons">
      <a class="button is-link is-light" href="${escapeAttribute(app.playUrl)}">Open in Play Store</a>
    </div>
  `;
}

interface DownloadViewState {
  versionCode: number | undefined;
  manifest: DeliveryManifest | null;
  error: string;
}

function downloadView(packageName: string, app: PlayApp | null, country: PlayCountry, state: DownloadViewState): string {
  return `
    <p><a href="${app ? `/app/${encodeURIComponent(app.packageName)}?gl=${country}` : `/?gl=${country}`}">Back</a></p>
    <h1 class="title">APK delivery</h1>
    <p class="subtitle">${escapeHtml(app?.name ?? packageName)} · <code>${escapeHtml(packageName)}</code></p>
    ${downloadForm(packageName, country, state.versionCode)}
    ${state.error ? `<div class="notification is-danger is-light">${escapeHtml(state.error)}</div>` : ""}
    ${state.manifest ? deliveryManifestView(state.manifest) : ""}
  `;
}

function downloadForm(packageName: string, country: PlayCountry, versionCode?: number): string {
  const idBase = packageName.replace(/[^A-Za-z0-9_-]/g, "-");
  return `
    <form class="box" method="get" action="/download/${encodeURIComponent(packageName)}" data-loading-form>
      <input type="hidden" name="gl" value="${country}">
      <input type="hidden" name="fetch" value="1">
      <div class="field">
        <label class="label" for="vc-${idBase}">Version code</label>
        <div class="control">
          <input id="vc-${idBase}" class="input" type="number" min="1" name="vc" value="${versionCode ?? ""}" placeholder="latest">
        </div>
        <p class="help">Leave blank for latest. Enter a known older version code to try it; this Play API path does not expose a version history list.</p>
      </div>
      <div class="field">
        <button class="button is-warning" type="submit">Fetch APK URLs</button>
      </div>
    </form>
  `;
}

function deliveryManifestView(manifest: DeliveryManifest): string {
  const version = manifest.versionName
    ? `version ${escapeHtml(manifest.versionName)} (code ${manifest.versionCode})`
    : `version code ${manifest.versionCode}`;
  return `
    <div class="notification is-success is-light">
      Found ${manifest.files.length} file${manifest.files.length === 1 ? "" : "s"} for ${version} with offer type ${manifest.offerType}.
    </div>
    <table class="table is-fullwidth">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Size</th>
          <th>Hash</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${manifest.files.map((file) => `
          <tr>
            <td>${escapeHtml(file.name)}</td>
            <td>${escapeHtml(file.type)}</td>
            <td>${escapeHtml(formatBytes(file.size))}</td>
            <td><code>${escapeHtml(file.sha256 || file.sha1 || "")}</code></td>
            <td><a class="button is-small is-link" href="${escapeAttribute(file.url)}">Download</a></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function countryOptions(selected: PlayCountry): string {
  return PLAY_COUNTRIES.map(({ code, name }) => {
    const selectedAttribute = code === selected ? " selected" : "";
    return `<option value="${code}"${selectedAttribute}>${code} - ${escapeHtml(name)}</option>`;
  }).join("");
}

function notFoundView(): string {
  return `
    <h1 class="title">Not found</h1>
    <p>The requested app could not be loaded from Google Play.</p>
    <p><a href="/">Back to search</a></p>
  `;
}

function errorView(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return `
    <h1 class="title">Request failed</h1>
    <div class="notification is-danger is-light">${escapeHtml(message)}</div>
    <p><a href="/">Back to search</a></p>
  `;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function notFound(message: string): Response {
  return json({ error: message }, 404);
}

function sanitizePlayHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "<br>")
    .replace(/<(?!\/?(br|p|ul|ol|li|strong|b|em|i)\b)[^>]*>/gi, "")
    .replace(/\s(on\w+|style|class|id)=("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

function plainTextFromPlayHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function formatNumber(value: number): string {
  return value ? new Intl.NumberFormat("en-US").format(value) : "Unknown";
}

function deliveryOptions(url: URL): { versionCode?: number; offerType?: number; certificateHash?: string } {
  return {
    versionCode: parsePositiveInteger(url.searchParams.get("vc") ?? url.searchParams.get("versionCode")),
    offerType: parsePositiveInteger(url.searchParams.get("ot") ?? url.searchParams.get("offerType")),
    certificateHash: url.searchParams.get("ch")?.trim() || undefined,
  };
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function formatBytes(value: number): string {
  if (!value) return "Unknown";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  for (const unit of units) {
    if (size < 1024) return `${size.toFixed(size < 10 ? 1 : 0)} ${unit}`;
    size /= 1024;
  }
  return `${size.toFixed(1)} TB`;
}
