# Hosted AdvantageScope Lite

`/logs/advantagescope` hosts the actual upstream Lite app, not a reimplementation. Each library recording has **Open in AdvantageScope**; the wrapper obtains an authenticated, short-lived download, verifies SHA-256, and transfers bytes to the same-origin viewer. Local WPILOG imports stay in the browser. No recording is sent to the upstream AdvantageScope website.

The viewer fills the window and preserves upstream tabs, field/robot assets, timeline, menus and preferences. Robot file collection and cloud sharing remain in Mayhem / Robot logs. Upstream on-robot download/upload/live-connection menus expect Systemcore services and are not provided by this website; use our library or local-file button. Hoot/REVLOG, pop-out windows, Video and XR are not supported by Lite.

## Reproducible upstream bundle

- Source: https://github.com/Mechanical-Advantage/AdvantageScope/tree/v27.0.0-alpha-6
- Official artifact: `advantagescope-lite-v27.0.0-alpha-6.ipk` from that release.
- SHA-256: `2836019cd1f31be79459df1c83eb2cb26a3fe5dbd3f5820a898c2fe2acc98890`
- License: BSD-3-Clause, Littleton Robotics. Original LICENSE and ThirdPartyLicenses.txt ship alongside the app.
- This is an upstream **alpha** release and an unofficial team-hosted distribution. Upstream beta notices are retained. Update the pin before upstream expiry.

`npm run dev` and `npm run build` prepare the pinned bundle with `scripts/vendor-advantagescope.mjs`. Generated assets are ignored by Git. Builds fail closed if the checksum or bridge anchors change. For offline builds set `ADVANTAGESCOPE_IPK` to a previously downloaded matching artifact.

Modifications are confined to the host: fixed asset base/index for static hosting, a readiness message, and the small same-origin in-memory WPILOG bridge in `scripts/advantagescope-bridge.js`. The graph/decoder/visualization bundles are unchanged. Messages require the exact parent window and origin, accept byte buffers rather than arbitrary URLs, and enforce the 250 MB limit. App pages and downloads require team sign-in. No private log is stored in the service-worker cache.
