# Phase 0 recon reports

Produced 2026-07-13 by an 8-agent recon workflow over the sibling repos (read-only), plus live unauthenticated probes of production. Start with [../api-surface.md](../api-surface.md) — it is the distilled contract; these are the full underlying reports.

| Report | What it covers |
|---|---|
| [panel-api.md](panel-api.md) | Full REST endpoint inventory from `ReFxHosting/apps/panel-api`: routes, DTOs, permission strings, envelopes, verbatim e2e-asserted bodies |
| [realtime-protocol.md](realtime-protocol.md) | Socket.IO console gateway: handshake, all events both directions, stats frames, token/expiry behavior, CORS, the dormant direct-agent WS |
| [android-client.md](android-client.md) | ReFxAndroid as a client reference: networking stack, envelope unwrap, refresh flow, ConsoleSocket, all Retrofit interfaces, wire fixtures |
| [ios-client.md](ios-client.md) | ReFxCompanion iOS app: origins, console socket, deep links/universal links, widgets, sign-in incl. passkeys |
| [deployment-status.md](deployment-status.md) | What's actually deployed (refx.gg / api.refx.gg, OVH nodes), implemented-vs-stubbed matrix, release mechanics, auth details from docs |
| [ecosystem-sweep.md](ecosystem-sweep.md) | Helios bot's removed ReFx integration (headless API-key pattern), hostname sweep, Pterodactyl-remnant verdict, local credential inventory |
| [parity-cross-check.md](parity-cross-check.md) | Adversarial cross-check of panel-api vs Android: 4 shipped Android bugs, confirmed contracts, confidence verdicts |
| [gaps-and-risks.md](gaps-and-risks.md) | Completeness critic: desktop-critical gaps (auth capability split, crash-notification primitives, file transfer, rate budget), each spot-checked or located |
