# Sprint 0 technical spike results

- Status: engineering-ready for Sprint 1; Product Owner sign-off pending
- Date: 2026-09-16
- Verified commit: `9dab02a`
- Verified Preview: `love-memory-mf8crsgys-devvitiens-projects.vercel.app`
- Scope limitation: physical Safari iOS, Android and in-app browser verification is deferred

## Spike A — MongoDB and Next.js

Implemented:

- one recoverable `MongoClient` promise cache per process;
- bounded pool/timeouts, retry reads/writes and Stable API;
- liveness and readiness routes;
- protected write/read/delete probe that checks client identity reuse;
- tests for initial failure recovery and cleanup on probe failure.

Live Preview evidence on 2026-09-16:

- liveness and MongoDB readiness returned HTTP 200;
- the protected probe verified write, read and cleanup;
- two concurrent client requests reused the same process-level `MongoClient` identity.

Conclusion: the connection architecture and Atlas Preview configuration are suitable for Sprint 1
repositories.

## Spike B — private Vercel Blob direct upload

Implemented:

- Vercel Blob adapter behind `ObjectStorage`;
- five-minute signed PUT bound to a random pathname, content type and maximum size;
- random identity-free object keys;
- private Blob metadata/byte verification;
- bounded object read, Sharp decode, MIME sniff, auto-orientation and EXIF-free WebP derivative;
- idempotent completion recovery after a lost response, private signed download and source cleanup;
- protected explicit cleanup for verifier-created source and derivative objects;
- CSP allowlist for Vercel Blob control/private origins and explicit cleanup behavior;
- protected browser lab and safe API responses.

Live Preview evidence on 2026-09-16:

- Vercel OIDC issued a five-minute upload URL for the connected private store;
- a browser-equivalent CORS preflight and direct `PUT` from the Preview origin succeeded;
- the completion route read the private source, produced an EXIF-free WebP derivative and deleted
  the source;
- the private signed download returned a non-empty `image/webp` response;
- Preview CSP allowed only the scoped Vercel Blob control path and Blob storage origin;
- verification derivatives were deleted and both source/derivative prefixes were confirmed empty.

Conclusion: application/provider boundaries, OIDC, signed constraints, CORS, processing and private
delivery are verified on Vercel Preview. Production processing still moves from the bounded route
spike to Trigger.dev in Sprint 2; this result does not enable production uploads by itself.

## Spike C — Template isolation

Implemented:

- independent `memory-box-spike` workspace with manifest, fixture and measured build budget;
- separate HTML document embedded in an iframe with only `allow-scripts`;
- versioned Zod host/template message protocol;
- source-window validation for opaque-origin sandbox messages;
- INIT/READY/PLAY/SCENE/PAUSE/COMPLETE/DESTROY lifecycle;
- artifact CSP blocks network, forms, objects, workers and framing by other origins;
- production E2E verifies play, completion, destroy and reload.

Conclusion: the isolation shape is safe enough to implement the Sprint 2 Viewer shell. Asset
resolution remains an explicit future capability; templates receive no arbitrary URL/network port.

## Spike D — Browser audio

Implemented:

- HTML media controller for play/pause/mute/destroy;
- normalized `blocked` result for autoplay `NotAllowedError`;
- fallback does not stop template/story progression;
- browser lab accepts a local file without upload/storage;
- unit coverage for playing, rejection, decode failure and cleanup.

Conclusion: Chrome/Windows implementation risk is bounded. Safari iOS, Android and in-app behavior
remains an explicit blocking gate before Viewer exit; see the browser support risk exception.

## Go/no-go

Sprint 1 domain/database/auth work may start after Product Owner accepts the UX baseline and Memory
Box storyboard. Do not treat the following as complete:

- Chrome/Windows manual audio playback checklist;
- Safari/Android/in-app audio verification;
- Product Owner UX/storyboard sign-off.

The deferred device matrix does not require redesigning Sprint 1, but it may not be waived for the
Viewer or an external pilot. Production Template 1 visual implementation remains Sprint 3 scope.
