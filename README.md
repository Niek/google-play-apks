# Google Play APK Worker

Minimal Cloudflare Worker that searches Google Play apps, shows current Play listing metadata, and has native Play FDFE APK delivery.

Live URL: [apk.niek.nl](https://apk.niek.nl/)

What works now:

- `/` shows a Bulma 1 search form.
- `/?q=signal` searches Google Play and renders app results.
- `/app/<packageName>` shows latest detected Play listing data: version name, update date, changelog, price/free state, and Play Store link.
- `/api/search?q=...` and `/api/app/<packageName>` expose JSON.
- `/download/<packageName>` and `/api/download/<packageName>` fetch anonymous auth from Aurora, then call Google Play native FDFE endpoints.

Native APK delivery:

- Uses Aurora's anonymous auth dispenser, then Google Play APIs: `/fdfe/details`, `/fdfe/purchase`, and `/fdfe/delivery`.
- Includes shared-library dependencies exposed by Play details, such as Chrome's Trichrome Library APK.
- Does not use APKMirror or other external APK sources.
- Does not require a local auth secret.

## Run

```sh
npm install
npm run types
npm run dev
```

If `vc` is omitted, the Worker detects the latest version code through `/fdfe/details`.
Google Play does not expose a version-history list through this FDFE path, so older versions require a known `vc` and may or may not still be deliverable.
Use `arch=arm64` for `arm64-v8a` delivery or `arch=amd64` for `x86_64` delivery. If omitted, the Worker uses `arm64`.
If `ot` is omitted, the Worker uses the offer type from Google Play details. Aurora treats this as Play response data, not as a fixed UI dropdown; `ot` is kept only as an advanced API override.

```sh
curl 'http://localhost:8787/api/download/org.thoughtcrime.securesms'
curl 'http://localhost:8787/api/download/org.thoughtcrime.securesms?arch=amd64&vc=123456&ot=1'
```
