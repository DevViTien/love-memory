export const MEMORY_BOX_SPIKE_DOCUMENT = String.raw`<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Memory Box isolation spike</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; overflow: hidden; background: radial-gradient(circle at 50% 30%, #4c1d3d, #120b18 65%); color: #fff7ed; }
      .scene { width: min(88vw, 32rem); text-align: center; }
      .box { position: relative; width: 9rem; height: 7rem; margin: 2rem auto; border-radius: 1rem; background: linear-gradient(135deg, #fb7185, #be123c); box-shadow: 0 1.5rem 5rem rgb(251 113 133 / 35%); transform: translateY(0) scale(1); transition: transform 600ms cubic-bezier(.2,.8,.2,1); }
      .box::before { content: ""; position: absolute; inset: -1.3rem -.4rem auto; height: 1.8rem; border-radius: .7rem; background: #fecdd3; }
      .box::after { content: "♥"; position: absolute; inset: 1.7rem 0 auto; font-size: 2rem; }
      body[data-state="playing"] .box { transform: translateY(-.8rem) scale(1.06) rotate(-2deg); }
      .eyebrow { color: #fda4af; font-size: .75rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { min-height: 2.5em; margin: .5rem 0; font-size: clamp(1.6rem, 7vw, 2.5rem); line-height: 1.1; }
      p { margin: 0; color: #fecdd3; }
      @media (prefers-reduced-motion: reduce) { .box { transition: none; } }
    </style>
  </head>
  <body data-state="idle">
    <main class="scene">
      <div class="eyebrow">Sandboxed template artifact</div>
      <div class="box" aria-hidden="true"></div>
      <h1 id="title">Đang chờ dữ liệu an toàn…</h1>
      <p id="status">INIT chưa được nhận</p>
    </main>
    <script>
      (() => {
        "use strict";
        const protocolVersion = 1;
        const title = document.getElementById("title");
        const status = document.getElementById("status");
        let initialized = false;
        let reducedMotion = false;
        let timer;

        const send = (message) => parent.postMessage(message, "*");
        const setState = (state, label) => {
          document.body.dataset.state = state;
          status.textContent = label;
        };
        const isInit = (data) => data && data.type === "INIT" &&
          data.protocolVersion === protocolVersion && data.payload &&
          typeof data.payload.title === "string" && data.context &&
          typeof data.context.prefersReducedMotion === "boolean";

        function onMessage(event) {
          if (event.source !== parent || !event.data || typeof event.data.type !== "string") return;
          const data = event.data;

          if (data.type === "INIT") {
            if (!isInit(data)) {
              send({ type: "ERROR", code: "INVALID_MESSAGE" });
              return;
            }
            initialized = true;
            reducedMotion = data.context.prefersReducedMotion;
            title.textContent = data.payload.title.slice(0, 80);
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
              setState("complete", "Hoàn tất — không có network call");
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
            setState("destroyed", "Runtime đã được destroy");
            window.removeEventListener("message", onMessage);
          }
        }

        window.addEventListener("message", onMessage);
      })();
    </script>
  </body>
</html>`;
