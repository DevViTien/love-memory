export const MEMORY_BOX_SPIKE_FIXTURES = {
  default: {
    "anniversary-date": "2024-09-15",
    "opening-message": "Cảm ơn vì đã biến những ngày bình thường thành ký ức đặc biệt.",
    photos: [
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440003",
    ],
    "receiver-name": "An",
    theme: "rose-night",
  },
  "max-length": {
    "anniversary-date": "2024-09-15",
    "opening-message": "K".repeat(400),
    photos: Array.from(
      { length: 12 },
      (_, index) => `550e8400-e29b-41d4-a716-${String(446655440001 + index).padStart(12, "0")}`,
    ),
    "receiver-name": "N".repeat(40),
    theme: "warm-paper",
  },
  "missing-fields": {},
};

export const MEMORY_BOX_SPIKE_DOCUMENT = String.raw`<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LoveMemory · Memory Box</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; overflow: hidden; background: radial-gradient(circle at 50% 30%, #4c1d3d, #120b18 65%); color: #fff7ed; }
      .scene { width: min(88vw, 42rem); text-align: center; }
      .box { position: relative; width: 9rem; height: 7rem; margin: 2rem auto; border-radius: 1rem; background: linear-gradient(135deg, #fb7185, #be123c); box-shadow: 0 1.5rem 5rem rgb(251 113 133 / 35%); transform: translateY(0) scale(1); transition: transform 600ms cubic-bezier(.2,.8,.2,1); }
      .box::before { content: ""; position: absolute; inset: -1.3rem -.4rem auto; height: 1.8rem; border-radius: .7rem; background: #fecdd3; }
      .box::after { content: "♥"; position: absolute; inset: 1.7rem 0 auto; font-size: 2rem; }
      body[data-state="playing"] .box { transform: translateY(-.8rem) scale(1.06) rotate(-2deg); }
      .eyebrow { color: #fda4af; font-size: .75rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { margin: .5rem 0; font-size: clamp(1.6rem, 7vw, 2.5rem); line-height: 1.1; }
      p { margin: .5rem 0 0; color: #fecdd3; }
      .photos { display: flex; justify-content: center; gap: .5rem; min-height: 3rem; margin-top: 1rem; }
      .photos img { width: 4rem; height: 3rem; object-fit: cover; border-radius: .5rem; }
      @media (prefers-reduced-motion: reduce) { .box { transition: none; } }
    </style>
  </head>
  <body data-state="idle">
    <main class="scene">
      <div class="eyebrow">LoveMemory sandbox runtime</div>
      <div class="box" aria-hidden="true"></div>
      <h1 id="title">Đang chờ dữ liệu an toàn…</h1>
      <p id="message"></p>
      <div class="photos" id="photos"></div>
      <p id="status">INIT chưa được nhận</p>
    </main>
    <script type="module" src="runtime.mjs"></script>
  </body>
</html>`;

export const MEMORY_BOX_SPIKE_RUNTIME = String.raw`(() => {
  "use strict";
  const protocolVersion = 1;
  const title = document.getElementById("title");
  const message = document.getElementById("message");
  const photos = document.getElementById("photos");
  const status = document.getElementById("status");
  let initialized = false;
  let reducedMotion = false;
  let timer;

  const send = (value) => parent.postMessage(value, "*");
  const setState = (state, label) => {
    document.body.dataset.state = state;
    status.textContent = label;
  };
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  const isInit = (data) => isRecord(data) && data.type === "INIT" &&
    data.protocolVersion === protocolVersion && isRecord(data.payload) &&
    isRecord(data.assets) && isRecord(data.context) &&
    typeof data.context.prefersReducedMotion === "boolean";
  const safeText = (value, fallback, limit) => typeof value === "string"
    ? value.slice(0, limit)
    : fallback;

  function mountImages(ids, assets) {
    photos.replaceChildren();
    if (!Array.isArray(ids)) return;
    for (const id of ids.slice(0, 12)) {
      if (typeof id !== "string" || typeof assets[id] !== "string") continue;
      const image = document.createElement("img");
      image.alt = "Ảnh kỷ niệm";
      image.loading = "eager";
      image.referrerPolicy = "no-referrer";
      image.src = assets[id];
      photos.append(image);
    }
  }

  function onMessage(event) {
    if (event.source !== parent || !isRecord(event.data) || typeof event.data.type !== "string") return;
    const data = event.data;
    if (data.type === "INIT") {
      if (!isInit(data)) {
        send({ type: "ERROR", code: "INVALID_MESSAGE" });
        return;
      }
      initialized = true;
      reducedMotion = data.context.prefersReducedMotion;
      title.textContent = safeText(data.payload["receiver-name"] ?? data.payload.title, "Kỷ niệm của chúng ta", 80);
      message.textContent = safeText(data.payload["opening-message"], "", 400);
      mountImages(data.payload.photos, data.assets);
      setState("ready", "Artifact sẵn sàng");
      send({ type: "READY", protocolVersion });
      return;
    }
    if (data.type === "PLAY") {
      if (!initialized) {
        send({ type: "ERROR", code: "INVALID_MESSAGE" });
        return;
      }
      clearTimeout(timer);
      setState("playing", "Đang mở hộp ký ức");
      send({ type: "SCENE", sceneId: "opening" });
      timer = setTimeout(() => {
        setState("complete", "Hoàn tất");
        send({ type: "COMPLETE" });
      }, reducedMotion ? 0 : 700);
      return;
    }
    if (data.type === "PAUSE") {
      clearTimeout(timer);
      setState("paused", "Đã tạm dừng");
      return;
    }
    if (data.type === "DESTROY") {
      clearTimeout(timer);
      initialized = false;
      photos.replaceChildren();
      setState("destroyed", "Runtime đã được destroy");
      window.removeEventListener("message", onMessage);
    }
  }

  window.addEventListener("message", onMessage);
})();`;
