"use client";

import { type LicensedAudioTrackDto } from "@love-memory/contracts";
import { type TemplateField } from "@love-memory/template-sdk";
import { type ReactNode, useState } from "react";
import { useStore } from "zustand";

import { MediaImageListField } from "@/modules/media/presentation/media-image-list-field";

import { selectFieldErrors, selectFieldsDisabled } from "./draft-editor-store";
import { textCounter } from "./draft-validation";
import { studioFieldInputId } from "./studio-steps";
import { useStudio } from "./studio-context";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-rose-200 bg-white aria-invalid:border-rose-600";

function readImageField(value: unknown): Readonly<{
  assetIds: string[];
  captions: Record<string, string>;
}> {
  const assetIds: string[] = [];
  const captions: Record<string, string> = {};
  for (const item of Array.isArray(value) ? (value as unknown[]) : []) {
    if (typeof item === "string") assetIds.push(item);
    else if (typeof item === "object" && item !== null && "assetId" in item) {
      const { assetId, caption } = item as Readonly<{ assetId: unknown; caption?: unknown }>;
      if (typeof assetId !== "string") continue;
      assetIds.push(assetId);
      if (typeof caption === "string") captions[assetId] = caption;
    }
  }
  return { assetIds, captions };
}

function describedBy(...ids: ReadonlyArray<string | null>): string | undefined {
  const present = ids.filter((id): id is string => id !== null);
  return present.length > 0 ? present.join(" ") : undefined;
}

function FieldFrame({
  children,
  error,
  errorId,
  field,
  inputId,
}: Readonly<{
  children: ReactNode;
  error: string | null;
  errorId: string;
  field: TemplateField;
  inputId: string;
}>) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-bold text-stone-800" htmlFor={inputId}>
          {field.label}
        </label>
        {field.required ? (
          <span className="text-xs font-semibold text-rose-700">Bắt buộc</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p className="mt-1 text-sm font-semibold text-rose-700" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AudioOptions({
  tracks,
  unavailable,
  value,
}: Readonly<{ tracks: readonly LicensedAudioTrackDto[]; unavailable: boolean; value: string }>) {
  return (
    <>
      <option value="">Không dùng nhạc</option>
      {unavailable ? (
        <option disabled value={value}>
          {value} (không còn khả dụng)
        </option>
      ) : null}
      {tracks.map((track) => (
        <option key={track.id} value={track.id}>
          {track.title} · {track.artist}
        </option>
      ))}
    </>
  );
}

/** Vietnamese names of known theme ids; an unknown id is shown as it is. */
const THEME_NAMES: Readonly<Record<string, string>> = {
  "rose-night": "Đêm hồng",
  "warm-paper": "Giấy ấm",
};

export function themeName(option: string): string {
  return THEME_NAMES[option] ?? option;
}

type TextField = Extract<TemplateField, Readonly<{ type: "longText" | "shortText" }>>;

/**
 * A text input that shows what the creator typed. Whitespace-only text is removed from the draft
 * content, but the input keeps it on screen, so a first space typed into an empty field does not
 * vanish. Stored text always wins; `key` remounts it when the stored draft replaces the content.
 */
function TextInput({
  describedById,
  disabled,
  field,
  inputId,
  invalid,
  onChange,
  stored,
}: Readonly<{
  describedById: string | undefined;
  disabled: boolean;
  field: TextField;
  inputId: string;
  invalid: true | undefined;
  onChange: (value: string) => void;
  stored: string;
}>) {
  const [typed, setTyped] = useState(stored);
  const shown = stored === "" && typed.trim() === "" ? typed : stored;
  const common = {
    "aria-describedby": describedById,
    "aria-invalid": invalid,
    disabled,
    id: inputId,
    maxLength: field.maxLength,
    onChange: (event: Readonly<{ target: Readonly<{ value: string }> }>) => {
      setTyped(event.target.value);
      onChange(event.target.value);
    },
    required: field.required,
    value: shown,
  };
  return (
    <>
      {field.type === "longText" ? (
        <textarea className={`${inputClassName} min-h-32 p-4`} {...common} />
      ) : (
        <input className={`${inputClassName} h-12 px-4`} type="text" {...common} />
      )}
      <p className="mt-1 text-right text-xs text-stone-500" id={`${inputId}-counter`}>
        {textCounter(shown, field.maxLength)}
      </p>
    </>
  );
}

/** One manifest field with its label, `Bắt buộc` marker, counter and inline error. */
export function StudioField({ field }: Readonly<{ field: TemplateField }>) {
  const { audioTracks, store } = useStudio();
  const value = useStore(store, (state) => state.content[field.id]);
  const error = useStore(store, (state) => selectFieldErrors(state)[field.id] ?? null);
  const setFieldValue = useStore(store, (state) => state.setFieldValue);
  const contentGeneration = useStore(store, (state) => state.contentGeneration);
  // Read-only while publishing and once the draft is no longer editable.
  const disabled = useStore(store, selectFieldsDisabled);
  const publicId = store.getState().context.publicId;
  const inputId = studioFieldInputId(field.id);
  const errorId = `${inputId}-error`;
  const counterId = `${inputId}-counter`;
  const text = typeof value === "string" ? value : "";
  const invalid = error ? true : undefined;

  if (field.type === "imageList" || field.type === "captionedImageList") {
    const { assetIds, captions } = readImageField(value);
    return (
      <div>
        {field.required ? (
          <p className="mb-2 text-right text-xs font-semibold text-rose-700">Bắt buộc</p>
        ) : null}
        <MediaImageListField
          aspectRatio={field.aspectRatio}
          captionMaxLength={
            field.type === "captionedImageList" ? field.captionMaxLength : undefined
          }
          disabled={disabled}
          errorMessageId={error ? errorId : undefined}
          fieldId={field.id}
          giftPublicId={publicId}
          initialAssetIds={assetIds}
          initialCaptions={captions}
          inputId={inputId}
          // Remount only when the stored draft replaces the content, so uploads keep running.
          key={`${field.id}:${contentGeneration}`}
          label={field.label}
          maxItems={field.maxItems}
          minItems={field.minItems}
          onChange={setFieldValue}
        />
        {error ? (
          <p className="mt-1 text-sm font-semibold text-rose-700" id={errorId}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (field.type === "audio") {
    const unavailable = text !== "" && !audioTracks.some((track) => track.id === text);
    return (
      <FieldFrame error={error} errorId={errorId} field={field} inputId={inputId}>
        {audioTracks.length === 0 && !unavailable ? (
          <p className="mt-2 rounded-2xl border border-dashed border-rose-200 bg-rose-50/60 p-4 text-sm text-stone-600">
            Chưa có nhạc để chọn
          </p>
        ) : (
          <select
            aria-describedby={describedBy(error ? errorId : null)}
            aria-invalid={invalid}
            className={`${inputClassName} h-12 px-4`}
            disabled={disabled}
            id={inputId}
            onChange={(event) => setFieldValue(field.id, event.target.value)}
            value={text}
          >
            <AudioOptions tracks={audioTracks} unavailable={unavailable} value={text} />
          </select>
        )}
        <p className="mt-1 text-xs text-stone-500">Nhạc chỉ phát khi người nhận chạm để mở quà.</p>
      </FieldFrame>
    );
  }

  if (field.type === "theme") {
    return (
      <FieldFrame error={error} errorId={errorId} field={field} inputId={inputId}>
        <select
          aria-describedby={describedBy(error ? errorId : null)}
          aria-invalid={invalid}
          className={`${inputClassName} h-12 px-4`}
          disabled={disabled}
          id={inputId}
          onChange={(event) => setFieldValue(field.id, event.target.value)}
          required={field.required}
          value={text}
        >
          {/* The template applies its first theme when none is chosen: name it as the default. */}
          <option value="">Mặc định ({themeName(field.options[0] ?? "")})</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {themeName(option)}
            </option>
          ))}
        </select>
      </FieldFrame>
    );
  }

  if (field.type === "date") {
    return (
      <FieldFrame error={error} errorId={errorId} field={field} inputId={inputId}>
        <input
          aria-describedby={describedBy(error ? errorId : null)}
          aria-invalid={invalid}
          className={`${inputClassName} h-12 px-4`}
          disabled={disabled}
          id={inputId}
          onChange={(event) => setFieldValue(field.id, event.target.value)}
          required={field.required}
          type="date"
          value={text}
        />
      </FieldFrame>
    );
  }

  return (
    <FieldFrame error={error} errorId={errorId} field={field} inputId={inputId}>
      <TextInput
        describedById={describedBy(counterId, error ? errorId : null)}
        disabled={disabled}
        field={field}
        inputId={inputId}
        invalid={invalid}
        key={contentGeneration}
        onChange={(next) => setFieldValue(field.id, next)}
        stored={text}
      />
    </FieldFrame>
  );
}
