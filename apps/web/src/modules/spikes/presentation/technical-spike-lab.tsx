"use client";

import {
  ApiErrorResponseSchema,
  MongoSpikeResponseSchema,
  UploadCompleteResponseSchema,
  UploadInitResponseSchema,
} from "@love-memory/contracts";
import {
  createMediaElementAudioController,
  createTemplateBridge,
  readTrustedTemplateEvent,
  type TemplateBridgeDependencies,
} from "@love-memory/template-sdk";
import { Button } from "@love-memory/ui";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

type TemplateBridge = ReturnType<typeof createTemplateBridge>;

function getApiErrorMessage(value: unknown): string {
  const parsed = ApiErrorResponseSchema.safeParse(value);
  return parsed.success
    ? `${parsed.data.error.message} (${parsed.data.error.requestId})`
    : "Yêu cầu thất bại với phản hồi không hợp lệ.";
}

export function TechnicalSpikeLab({ spikesEnabled }: Readonly<{ spikesEnabled: boolean }>) {
  const [token, setToken] = useState("");
  const [uploadStatus, setUploadStatus] = useState("Chưa chọn ảnh.");
  const [downloadUrl, setDownloadUrl] = useState<string>();
  const [mongoStatus, setMongoStatus] = useState("Chưa chạy probe.");
  const [templateStatus, setTemplateStatus] = useState("Đang tải artifact…");
  const [frameKey, setFrameKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<TemplateBridge>(undefined);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string>(undefined);
  const [audioStatus, setAudioStatus] = useState("Chọn một file audio có sẵn trên máy.");

  const onTemplateFrameLoad = useCallback(() => {
    bridgeRef.current?.disconnect();
    const targetWindow = frameRef.current?.contentWindow;

    if (!targetWindow) {
      setTemplateStatus("Không truy cập được sandbox window.");
      return;
    }

    const dependencies: TemplateBridgeDependencies = {
      onEvent: (event) => {
        const label =
          event.type === "SCENE"
            ? `SCENE: ${event.sceneId}`
            : event.type === "ERROR"
              ? `ERROR: ${event.code}`
              : event.type;
        setTemplateStatus(label);
      },
      postMessage: (message) => targetWindow.postMessage(message, "*"),
      subscribe: (listener) => {
        const onMessage = (event: MessageEvent<unknown>) => {
          const trustedEvent = readTrustedTemplateEvent(event, targetWindow);

          if (trustedEvent) {
            listener(trustedEvent);
          }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
      },
    };
    const bridge = createTemplateBridge(dependencies);
    bridgeRef.current = bridge;
    bridge.start();
    bridge.initialize(
      { title: "Một chiếc hộp dành riêng cho hai đứa" },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);

  useEffect(() => {
    // The iframe may finish loading before React hydrates and attaches its onLoad handler.
    // Connect once after hydration; onLoad retries safely when navigation is still in progress.
    onTemplateFrameLoad();

    return () => {
      bridgeRef.current?.destroy();

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, [onTemplateFrameLoad]);

  async function runUpload(file: File) {
    setDownloadUrl(undefined);
    setUploadStatus("Đang xin quyền upload ngắn hạn…");

    try {
      const initResponse = await fetch("/api/spikes/uploads/init", {
        body: JSON.stringify({ contentType: file.type, fileName: file.name, sizeBytes: file.size }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
      const initBody: unknown = await initResponse.json();

      if (!initResponse.ok) {
        throw new Error(getApiErrorMessage(initBody));
      }

      const initialized = UploadInitResponseSchema.parse(initBody).data;
      setUploadStatus("Đang PUT trực tiếp từ browser lên Vercel Blob private…");
      const uploadResponse = await fetch(initialized.uploadUrl, {
        body: file,
        headers: initialized.headers,
        method: initialized.method,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Vercel Blob từ chối upload với HTTP ${uploadResponse.status}.`);
      }

      setUploadStatus("Đang xác minh và tạo WebP derivative…");
      const completeResponse = await fetch("/api/spikes/uploads/complete", {
        body: JSON.stringify({ assetId: initialized.assetId }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
      const completeBody: unknown = await completeResponse.json();

      if (!completeResponse.ok) {
        throw new Error(getApiErrorMessage(completeBody));
      }

      const completed = UploadCompleteResponseSchema.parse(completeBody).data;
      setDownloadUrl(completed.downloadUrl);
      setUploadStatus(`Hoàn tất: ${completed.width}×${completed.height} WebP.`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "Upload thất bại.");
    }
  }

  async function runMongoProbe() {
    setMongoStatus("Đang kiểm tra pool, write, read và cleanup…");

    try {
      const response = await fetch("/api/spikes/mongodb", {
        headers: { authorization: `Bearer ${token}` },
        method: "POST",
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(body));
      }

      MongoSpikeResponseSchema.parse(body);
      setMongoStatus("PASS: connection được reuse; write/read/cleanup thành công.");
    } catch (error) {
      setMongoStatus(error instanceof Error ? error.message : "MongoDB probe thất bại.");
    }
  }

  function onAudioSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const audio = audioRef.current;

    if (!file || !audio) {
      return;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    audio.src = url;
    audio.load();
    setAudioStatus("Sẵn sàng. Hãy bấm Phát để xác minh user gesture.");
  }

  async function playAudio() {
    if (!audioRef.current?.src) {
      setAudioStatus("Hãy chọn file audio trước.");
      return;
    }

    const result = await createMediaElementAudioController(audioRef.current).play();
    setAudioStatus(
      result === "playing"
        ? "PLAYING"
        : result === "blocked"
          ? "BLOCKED: browser yêu cầu người dùng chạm nút phát."
          : "FAILED: browser không decode/play được file.",
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-stone-900">Credential cho technical spike</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Endpoint mutation mặc định bị ẩn. Token chỉ dùng cho preview/local và không được lưu vào
          browser storage.
        </p>
        <label className="mt-4 block text-sm font-semibold text-stone-800" htmlFor="spike-token">
          Technical spike token
        </label>
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-mono text-sm"
          id="spike-token"
          onChange={(event) => setToken(event.target.value)}
          type="password"
          value={token}
        />
        <p className="mt-2 text-xs text-stone-500">
          Trạng thái server: {spikesEnabled ? "đã bật" : "đang tắt"}.
        </p>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-stone-900">A · Vercel Blob direct upload</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Chọn JPEG, PNG hoặc WebP tối đa 10 MiB. Tên file không được đưa vào object key.
        </p>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="mt-4 block w-full text-sm"
          disabled={!spikesEnabled || token.length === 0}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void runUpload(file);
          }}
          type="file"
        />
        <p aria-live="polite" className="mt-3 text-sm text-stone-700">
          {uploadStatus}
        </p>
        {downloadUrl ? (
          <a
            className="mt-3 inline-flex text-sm font-bold text-rose-700 underline"
            href={downloadUrl}
            rel="noreferrer"
            target="_blank"
          >
            Mở derivative bằng signed URL
          </a>
        ) : null}
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-stone-900">B · Sandboxed template</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          iframe chỉ có <code>allow-scripts</code>; không có same-origin hoặc network capability.
        </p>
        <iframe
          className="mt-4 aspect-[4/3] w-full rounded-2xl border border-stone-300 bg-stone-950"
          key={frameKey}
          onLoad={onTemplateFrameLoad}
          ref={frameRef}
          sandbox="allow-scripts"
          src="/template-spikes/memory-box"
          title="Memory Box sandbox spike"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => bridgeRef.current?.play()} size="sm">
            Play
          </Button>
          <Button onClick={() => bridgeRef.current?.pause()} size="sm" variant="outline">
            Pause
          </Button>
          <Button
            onClick={() => {
              bridgeRef.current?.destroy();
              setTemplateStatus("DESTROY sent");
            }}
            size="sm"
            variant="outline"
          >
            Destroy
          </Button>
          <Button
            onClick={() => {
              setTemplateStatus("Đang reload artifact…");
              setFrameKey((key) => key + 1);
            }}
            size="sm"
            variant="outline"
          >
            Reload
          </Button>
        </div>
        <p aria-live="polite" className="mt-3 font-mono text-sm text-stone-700">
          Event: {templateStatus}
        </p>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-stone-900">C · Mobile audio fallback</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          File chỉ tồn tại cục bộ trong tab này, phục vụ kiểm tra play Promise và user gesture.
        </p>
        <input
          accept="audio/*"
          className="mt-4 block w-full text-sm"
          onChange={onAudioSelected}
          type="file"
        />
        <audio className="mt-4 w-full" controls preload="metadata" ref={audioRef}>
          <track kind="captions" />
        </audio>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void playAudio()} size="sm">
            Phát
          </Button>
          <Button
            onClick={() =>
              audioRef.current && createMediaElementAudioController(audioRef.current).pause()
            }
            size="sm"
            variant="outline"
          >
            Pause
          </Button>
          <Button
            onClick={() => {
              if (audioRef.current) {
                const muted = createMediaElementAudioController(audioRef.current).toggleMuted();
                setAudioStatus(muted ? "MUTED" : "UNMUTED");
              }
            }}
            size="sm"
            variant="outline"
          >
            Mute / unmute
          </Button>
        </div>
        <p aria-live="polite" className="mt-3 text-sm text-stone-700">
          {audioStatus}
        </p>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-stone-900">D · MongoDB pool/read/write</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Probe tạo một document ngẫu nhiên, đọc lại và xóa trong khối finally.
        </p>
        <Button
          className="mt-4"
          disabled={!spikesEnabled || token.length === 0}
          onClick={() => void runMongoProbe()}
          size="sm"
        >
          Chạy MongoDB probe
        </Button>
        <p aria-live="polite" className="mt-3 text-sm text-stone-700">
          {mongoStatus}
        </p>
      </section>
    </div>
  );
}
