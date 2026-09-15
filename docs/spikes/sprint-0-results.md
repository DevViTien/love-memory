# Sprint 0 technical spike results

- Status: conditionally ready for Sprint 1
- Date: 2026-09-16
- Scope limitation: a private Vercel Blob Store and non-Chrome physical browsers are not configured yet

## Spike A — MongoDB and Next.js

Implemented:

- one recoverable `MongoClient` promise cache per process;
- bounded pool/timeouts, retry reads/writes and Stable API;
- liveness and readiness routes;
- protected write/read/delete probe that checks client identity reuse;
- tests for initial failure recovery and cleanup on probe failure.

Conclusion: the connection architecture is suitable for Sprint 1 repositories. Run the protected
probe on the first Vercel Preview to validate Atlas network access and process reuse evidence.

## Spike B — private Vercel Blob direct upload

Implemented:

- Vercel Blob adapter behind `ObjectStorage`;
- five-minute signed PUT bound to a random pathname, content type and maximum size;
- random identity-free object keys;
- private Blob metadata/byte verification;
- bounded object read, Sharp decode, MIME sniff, auto-orientation and EXIF-free WebP derivative;
- private signed download and source cleanup;
- CSP allowlist for Vercel Blob control/private origins and explicit cleanup behavior;
- protected browser lab and safe API responses.

Conclusion: application/provider boundaries and failure behavior are known. A live private Blob run
is still required before the upload flag can be enabled outside preview. Production processing moves
from the bounded route spike to Trigger.dev in Sprint 2.

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

- Vercel Preview direct-upload/OIDC verification;
- first Vercel Preview Mongo probe;
- Safari/Android/in-app audio verification;
- production Template 1 visual implementation.

These items do not require redesigning Sprint 1, but their gates may not be waived for the Viewer,
external pilot or production upload.
