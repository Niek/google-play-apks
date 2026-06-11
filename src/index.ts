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
  async fetch(request: Request, env: Env): Promise<Response> {
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
          return json(await getDeliveryManifest(packageName, deliveryOptions(url), env.AUTH_CACHE));
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
        // The app lookup only feeds the page header, so fetch it alongside the
        // manifest and render without it if Play metadata is unavailable.
        const appPromise = getApp(packageName, country).catch(() => null);
        let manifest: DeliveryManifest | null = null;
        let error = "";
        const shouldFetch = url.searchParams.get("fetch") === "1" || parsePositiveInteger(url.searchParams.get("vc")) !== undefined;
        if (shouldFetch) {
          try {
            manifest = await getDeliveryManifest(packageName, deliveryOptions(url), env.AUTH_CACHE);
          } catch (caught) {
            error = errorMessage(caught);
          }
        }
        const app = await appPromise;
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
  <nav class="navbar is-link" role="navigation" aria-label="main navigation">
    <div class="container">
      <div class="navbar-brand">
        <a class="navbar-item has-text-weight-bold" href="/">&#128230;&nbsp;Google Play APKs</a>
      </div>
    </div>
  </nav>
  <section class="section">
    <div class="container is-max-desktop">
      ${body}
    </div>
  </section>
  <footer class="footer">
    <div class="content has-text-centered is-size-7 has-text-grey">
      <a href="${GITHUB_URL}">Niek/google-play-apks</a> &middot; not affiliated with Google
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
    <h1 class="title">Search Google Play</h1>
    <p class="subtitle is-6 has-text-grey">Look up apps and fetch APK download URLs straight from Google Play.</p>
    <form class="box" method="get" action="/">
      <div class="field has-addons">
        <div class="control is-expanded">
          <input class="input" type="search" name="q" value="${escapeAttribute(query)}" placeholder="App name or package" autofocus>
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
      </div>
    </form>
    ${query ? resultsView(query, country, apps) : `
    <div class="has-text-centered py-6">
      <p class="title is-4 has-text-grey-light">Nothing here yet</p>
      <p class="has-text-grey">Search for an app to get started.</p>
    </div>`}
  `;
}

function resultsView(query: string, country: PlayCountry, apps: PlayApp[]): string {
  if (apps.length === 0) {
    return `<div class="notification is-warning is-light">No apps found for <strong>${escapeHtml(query)}</strong>.</div>`;
  }

  return `
    <h2 class="subtitle is-6 has-text-grey">
      ${apps.length} result${apps.length === 1 ? "" : "s"} for <strong>${escapeHtml(query)}</strong>
      <span class="tag is-light">${escapeHtml(country)}</span>
    </h2>
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
          <p class="title is-5 mb-1"><a href="/app/${encodeURIComponent(app.packageName)}?gl=${country}">${escapeHtml(app.name)}</a></p>
          <p class="is-size-7 has-text-grey mb-2">
            ${escapeHtml(app.developer)} &middot; <span class="is-family-monospace">${escapeHtml(app.packageName)}</span>
          </p>
          <p class="mb-2">${escapeHtml(plainTextFromPlayHtml(app.shortDescription))}</p>
          <div class="tags">
            <span class="tag is-link is-light">${escapeHtml(app.versionName || "unknown version")}</span>
            <span class="tag is-light">${escapeHtml(app.updatedOn || "unknown date")}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function appPage(app: PlayApp, country: PlayCountry): string {
  return shell(app.name, `
    <nav class="breadcrumb is-small" aria-label="breadcrumbs">
      <ul>
        <li><a href="/?gl=${country}">Search</a></li>
        <li class="is-active"><a href="#" aria-current="page">${escapeHtml(app.name)}</a></li>
      </ul>
    </nav>
    <div class="media">
      <div class="media-left">
        ${app.iconUrl ? `<figure class="image is-96x96"><img src="${escapeAttribute(app.iconUrl)}" alt=""></figure>` : ""}
      </div>
      <div class="media-content">
        <h1 class="title mb-2">${escapeHtml(app.name)}</h1>
        <p class="subtitle is-6 has-text-grey mb-2">
          ${escapeHtml(app.developer)} &middot; <span class="is-family-monospace">${escapeHtml(app.packageName)}</span>
        </p>
        <div class="tags">
          <span class="tag is-link is-light">${escapeHtml(app.category || "Unknown category")}</span>
          <span class="tag is-success is-light">${escapeHtml(app.price)}</span>
        </div>
      </div>
    </div>

    <div class="box mt-5">
      <nav class="level">
        ${[
          ["Latest version", app.versionName || "Unknown"],
          ["Updated on", app.updatedOn || "Unknown"],
          ["Installs", app.downloadLabel || formatNumber(app.installs)],
          ["Rating", app.ratingLabel || app.rating.toFixed(1)],
        ].map(([label, value]) => `
        <div class="level-item has-text-centered">
          <div>
            <p class="heading">${escapeHtml(label)}</p>
            <p class="title is-5">${escapeHtml(value)}</p>
          </div>
        </div>`).join("")}
      </nav>
    </div>

    ${app.changesHtml ? `
    <article class="message is-info">
      <div class="message-header"><p>What's new</p></div>
      <div class="message-body content">${sanitizePlayHtml(app.changesHtml)}</div>
    </article>` : ""}

    <h2 class="title is-4 mt-6">APK downloads</h2>
    ${downloadNotice(app, country)}

    <h2 class="title is-4 mt-6">Description</h2>
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
    <nav class="breadcrumb is-small" aria-label="breadcrumbs">
      <ul>
        <li><a href="/?gl=${country}">Search</a></li>
        ${app ? `<li><a href="/app/${encodeURIComponent(app.packageName)}?gl=${country}">${escapeHtml(app.name)}</a></li>` : ""}
        <li class="is-active"><a href="#" aria-current="page">APK delivery</a></li>
      </ul>
    </nav>
    <h1 class="title">APK delivery</h1>
    <p class="subtitle is-6 has-text-grey">
      ${escapeHtml(app?.name ?? packageName)} &middot; <span class="is-family-monospace">${escapeHtml(packageName)}</span>
    </p>
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
        <button class="button is-link" type="submit">Fetch APK URLs</button>
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
    <div class="table-container">
      <table class="table is-fullwidth is-striped is-hoverable">
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
              <td class="is-family-monospace is-size-7">${escapeHtml(file.name)}</td>
              <td><span class="tag">${escapeHtml(file.type)}</span></td>
              <td>${escapeHtml(formatBytes(file.size))}</td>
              <td><code class="is-size-7">${escapeHtml(file.sha256 || file.sha1 || "")}</code></td>
              <td><a class="button is-small is-link" href="${escapeAttribute(file.url)}">Download</a></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
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
    <div class="has-text-centered py-6">
      <h1 class="title">Not found</h1>
      <p class="subtitle is-6 has-text-grey">The requested app could not be loaded from Google Play.</p>
      <a class="button is-link is-light" href="/">Back to search</a>
    </div>
  `;
}

function errorView(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return `
    <h1 class="title">Request failed</h1>
    <div class="notification is-danger is-light">${escapeHtml(message)}</div>
    <a class="button is-link is-light" href="/">Back to search</a>
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
