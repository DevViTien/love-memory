# Sprint 0 product and UX baseline

- Status: ready for Product Owner review
- Scope: browser-first MVP, mobile-first layout
- Primary creator: a person preparing a private digital gift for their partner
- Primary receiver: a person opening a shared URL without an account

This document turns the product narrative in `idea.md` into an implementation baseline. Copy and
visual styling may evolve; route responsibilities and failure states are the Sprint 1 contract.

## Creator flow

1. Open Catalog and compare templates by occasion, mood, duration and photo requirement.
2. Open Template Detail, view a safe demo and review required inputs.
3. Select Create; an anonymous draft identifier is created server-side.
4. Complete Studio steps: story → media → style/audio → access → preview.
5. Upload images directly to private Vercel Blob pathnames; Studio displays processing state and retry.
6. Preview using the same template version/runtime used by the final Viewer.
7. Authenticate by passwordless email when claiming or publishing the draft.
8. Select free entitlement or checkout; payment return alone never publishes a gift.
9. Publish an immutable snapshot, then receive a short URL and PNG/SVG QR.
10. Use Dashboard to edit a new revision, pause, resume, expire or delete the gift.

Recovery rules:

- Refresh never silently discards a confirmed server revision.
- A revision conflict offers reload/copy recovery rather than last-write-wins.
- Upload failure preserves text and already-ready media.
- Authentication cancellation returns to the same anonymous draft.
- Payment ambiguity shows pending/retry support state, never a false success.

## Receiver flow

1. Open URL or scan QR; no login is required.
2. Server evaluates paused/expired/password/scheduled policy before returning private payload.
3. Viewer shows an immediately usable cover and a clear “Chạm để mở” control.
4. The gesture starts animation and optionally audio; rejected audio falls back to a visible play
   control.
5. Receiver can pause, mute, replay and continue without completing optional interactions.
6. Reduced-motion preference keeps the story readable with transitions minimized.
7. Completion may show a private response/share CTA only when the creator allowed it.

## Information architecture

| Area                      | Primary responsibility                           | Authentication               |
| ------------------------- | ------------------------------------------------ | ---------------------------- |
| `/` and `/templates`      | Product promise and template catalog             | None                         |
| `/templates/[templateId]` | Requirements, demo, duration and create CTA      | None                         |
| `/studio/new`             | Anonymous/authenticated draft editor and preview | Deferred until claim/publish |
| `/checkout/[giftId]`      | Entitlement selection and payment status         | Creator required             |
| `/dashboard`              | Creator-owned gift lifecycle                     | Creator required             |
| `/g/[publicId]`           | Receiver access envelope and Viewer              | None; gift policy applies    |
| `/admin`                  | Moderation, audit and deletion support           | Admin + MFA                  |
| `/studio/spikes`          | Protected engineering verification only          | Preview/local spike token    |

## Mobile wireframes

### Catalog and detail

```text
┌──────────────────────────┐
│ LoveMemory          Menu │
│                          │
│ Một món quà biết kể      │
│ chuyện                   │
│ [Khám phá template]      │
│                          │
│ [Filter chips →]         │
│ ┌──────────────────────┐ │
│ │ Preview              │ │
│ │ Hộp ký ức            │ │
│ │ 6–10 ảnh · 60 giây   │ │
│ │ [Xem chi tiết]       │ │
│ └──────────────────────┘ │
└──────────────────────────┘

┌──────────────────────────┐
│ ← Template               │
│ [Safe looping demo]      │
│ Hộp ký ức                │
│ Cần 6–10 ảnh, lời nhắn   │
│ [Tạo với mẫu này]        │
│ Fields · privacy · FAQ   │
└──────────────────────────┘
```

### Studio and preview

```text
┌──────────────────────────┐
│ ← Thoát     Bước 2 / 5   │
│ ●──●──○──○──○            │
│ Ảnh kỷ niệm              │
│ ┌────────┐ ┌────────┐    │
│ │ ready  │ │ upload │    │
│ └────────┘ └────────┘    │
│ [Thêm ảnh]               │
│                          │
│ Lưu tự động: 10:42       │
│ [Quay lại] [Tiếp tục]    │
└──────────────────────────┘

┌──────────────────────────┐
│ ← Chỉnh sửa     Preview  │
│ ┌──────────────────────┐ │
│ │ same Viewer runtime  │ │
│ │ [Chạm để mở]         │ │
│ └──────────────────────┘ │
│ [Publish]                │
└──────────────────────────┘
```

### Receiver

```text
┌──────────────────────────┐
│                          │
│       Gift cover         │
│                          │
│   Dành riêng cho An      │
│    [Chạm để mở]          │
│                          │
│ Âm thanh: đang tắt       │
└──────────────────────────┘

┌──────────────────────────┐
│ [Pause] [Mute] [Replay]  │
│                          │
│       Scene content      │
│                          │
│ Tiếp tục ›               │
└──────────────────────────┘
```

## Required states

| Surface   | Loading                  | Empty                   | Recoverable error          | Terminal/denied                             |
| --------- | ------------------------ | ----------------------- | -------------------------- | ------------------------------------------- |
| Catalog   | Card skeleton            | No matching filter      | Retry catalog              | Generic maintenance                         |
| Studio    | Revision/upload progress | Guidance per field      | Retry/conflict recovery    | Unauthorized/expired claim                  |
| Preview   | Cover skeleton           | Missing required fields | Template fallback          | Incompatible template                       |
| Viewer    | Usable cover first       | Not applicable          | Static story/audio control | Paused/expired/not-found/scheduled/password |
| Dashboard | Gift-card skeleton       | Create-first-gift CTA   | Retry list                 | Session expired                             |
| Checkout  | Pending indicator        | No eligible plan        | Reconcile/retry            | Cancelled/expired                           |

## Template field schema v1

The canonical implementation is `TemplateManifestSchema` in `@love-memory/template-sdk`. Version 1
supports short text, long text, date, image list with item/aspect limits, theme options and licensed
audio. Field identifiers are unique and manifests carry immutable semantic versions, capabilities,
preview fixtures and performance budgets.

## Product Owner sign-off

- [ ] Creator flow is acceptable for Sprint 1 draft/auth work.
- [ ] Receiver does not require an account.
- [ ] IA route ownership is accepted.
- [ ] Mobile wireframes cover the intended happy path.
- [ ] Required loading/empty/error states are accepted.
- [ ] “Hộp ký ức” remains Template 1.

Approval changes this document’s status to `accepted`. Material flow changes require updating Sprint
1 acceptance criteria before implementation.
