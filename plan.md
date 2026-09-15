# LoveMemory — Kế hoạch phát triển phần mềm chi tiết

> Phiên bản: 15/09/2026  
> Tài liệu nền: [idea.md](./idea.md) và [tech-stack.md](./tech-stack.md)  
> Phạm vi: phát triển một Paid MVP production-ready trên web browser  
> Không bao gồm: marketing, SEO campaign, bán hàng, quan hệ đối tác, vận hành nội dung mạng xã hội hoặc các hoạt động phân phối sản phẩm.

## 1. Tóm tắt kế hoạch

Mục tiêu của kế hoạch là xây dựng một phiên bản LoveMemory mà:

- Người tạo có thể dùng điện thoại chọn một trong ba template, nhập nội dung, tải ảnh, xem trước, xác thực, thanh toán nếu cần và publish.
- Người nhận mở bằng URL hoặc QR, không cần tài khoản, xem được animation mượt và đúng quyền truy cập.
- Người tạo có thể sửa, pause, gia hạn hoặc xóa món quà.
- Hệ thống có khả năng xử lý media, scheduled reveal, payment webhook, report/takedown và lỗi vận hành.
- Gift đã publish gắn với một template version bất biến.
- Sản phẩm đạt baseline về bảo mật, riêng tư, accessibility, performance, backup và quan sát hệ thống.

Kế hoạch chuẩn gồm **8 sprint × 2 tuần = 16 tuần** cho đội hình:

- 3 kỹ sư full-time:
  - 1 Frontend/Creative Engineer;
  - 1 Full-stack/Platform Engineer;
  - 1 Product/Full-stack Engineer tập trung Studio, integration và test automation.
- 0,5 Product Designer trong 10 tuần đầu.
- 0,5 QA Engineer từ sprint 3.
- Product Owner/Tech Lead có thể do một kỹ sư kiêm nhiệm nếu đội nhỏ.

Kết quả qua các mốc:

| Mốc | Thời điểm mục tiêu | Kết quả |
|---|---:|---|
| M0 — Foundation ready | Cuối tuần 2 | Repo, CI, môi trường, ADR và skeleton hoạt động |
| M1 — Core platform ready | Cuối tuần 6 | Auth, gift domain, media pipeline và Viewer runtime cơ bản |
| M2 — Vertical slice | Cuối tuần 8 | Một template chạy end-to-end từ tạo đến mở |
| M3 — Free pilot candidate | Cuối tuần 10 | Ba template, publish, access policy và QR |
| M4 — Paid MVP candidate | Cuối tuần 12 | Thanh toán, dashboard và background workflows |
| M5 — Release candidate | Cuối tuần 14 | Admin, privacy/deletion, security baseline |
| M6 — Production-ready | Cuối tuần 16 | Hardening, performance, restore drill và release sign-off |

Mốc quan trọng nhất là **M2 — vertical slice**. Nếu chưa làm được một gift thật chạy trọn vẹn, không nên đồng thời mở rộng thêm template hoặc tính năng.

---

## 2. Các giả định dùng để lập kế hoạch

### 2.1. Giả định sản phẩm

- MVP tập trung người tạo quà cho người yêu/vợ/chồng.
- Web browser là nền tảng duy nhất; không có mobile app native.
- Ba template MVP:
  1. Hộp ký ức;
  2. Dòng thời gian hai đứa;
  3. Bầu trời lời nhắn.
- Input MVP gồm text, date, ảnh, theme và nhạc từ thư viện có quyền sử dụng.
- Viewer không yêu cầu đăng nhập.
- Creator dùng passwordless email.
- Gift hỗ trợ unlisted, password và scheduled reveal.
- QR có PNG và SVG.
- Có free entitlement và một paid entitlement.
- Không có public gallery.
- Không có user-generated template.
- Không có realtime collaboration.
- Reaction/voice note là sau MVP, trừ khi sprint còn capacity.

### 2.2. Giả định kỹ thuật

- Next.js App Router, React, TypeScript, Tailwind.
- MongoDB Atlas là operational database.
- R2/S3-compatible storage lưu media và template artifacts.
- Template runtime có manifest/version và được cách ly.
- Background job dùng dịch vụ managed trong giai đoạn đầu.
- Payment đi qua BillingProvider; payOS là provider đầu tiên.
- Hạ tầng managed-first, không Kubernetes/microservices.

### 2.3. Phạm vi “không phân phối”

Kế hoạch vẫn bao gồm:

- môi trường staging/production;
- CI/CD;
- deploy và rollback;
- analytics kỹ thuật;
- production readiness;
- payment integration;
- email hệ thống;
- tài liệu vận hành.

Kế hoạch không bao gồm:

- chiến dịch acquisition;
- nội dung TikTok/Reels;
- SEO content production;
- ký kết xưởng quà/NFC;
- chính sách affiliate;
- sales CRM;
- app-store distribution;
- hoạt động launch event.

---

## 3. Mục tiêu, non-goals và tiêu chí thành công

### 3.1. Mục tiêu chức năng

1. Tạo draft không cần đăng nhập ngay.
2. Claim draft sau khi xác thực.
3. Upload/crop/reorder ảnh an toàn.
4. Render preview bằng cùng runtime với gift thật.
5. Publish snapshot bất biến.
6. Nhận URL và QR.
7. Bảo vệ bằng unlisted/password/schedule.
8. Viewer chạy tốt trên mobile/in-app browser mục tiêu.
9. Thanh toán idempotent.
10. Owner quản lý lifecycle.
11. Admin có thể xử lý report và pause gift.
12. Owner có thể yêu cầu xóa dữ liệu.

### 3.2. Mục tiêu phi chức năng

- Không có PII trong QR, log và analytics event.
- Không lưu binary trong MongoDB.
- Viewer core usable khi animation/audio thất bại.
- Gift version cũ không đổi khi publish template mới.
- LCP Viewer mục tiêu ≤ 2,5 giây ở p75 sau khi có dữ liệu thực.
- INP mục tiêu ≤ 200 ms; CLS ≤ 0,1.
- Fatal viewer session dưới 1%.
- Asset processing failure dưới 2%.
- Publish/payment flow có retry và idempotency.
- Có restore drill trước khi nhận thanh toán thật.

### 3.3. Non-goals của MVP

- Editor kéo-thả tự do.
- Video editor.
- AI tạo toàn bộ nội dung.
- Template marketplace.
- Public social feed.
- Couple social network.
- 3D/WebGL bắt buộc.
- Upload bài hát thương mại tùy ý.
- Subscription phức tạp.
- Multi-region active-active.
- Data warehouse riêng.
- Native application.

### 3.4. Definition of product success cho giai đoạn phát triển

Một build được xem là MVP hoàn chỉnh khi:

- Luồng create → upload → preview → payment/free entitlement → publish → open chạy tự động.
- Ba template vượt cùng một contract test.
- Các quyền unlisted/password/scheduled hoạt động đúng trên server.
- Có thể pause/delete gift và thu hồi Viewer access.
- Payment event lặp không tạo hai entitlement hoặc publish hai lần.
- Không có blocker/critical defect chưa xử lý.
- Critical E2E pass trên browser matrix đã chốt.
- Security, performance, backup và deletion checklist đã sign-off.

---

## 4. Đội ngũ và trách nhiệm

### 4.1. Vai trò

**Product Owner**

- Chốt phạm vi, acceptance criteria và thứ tự ưu tiên.
- Trả lời quyết định nội dung/template trong một ngày làm việc.
- Không thêm scope giữa sprint nếu không đổi thứ tự ưu tiên.

**Tech Lead**

- Chốt ADR và kiến trúc.
- Review thay đổi security/domain/data.
- Quản lý technical risk và release gate.
- Bảo đảm một vertical slice hoàn thành trước khi mở rộng.

**Frontend/Creative Engineer**

- Studio/editor.
- Viewer shell.
- Template SDK phía client.
- Animation, audio, reduced-motion và browser compatibility.
- Visual regression/performance frontend.

**Full-stack/Platform Engineer**

- Domain, API, MongoDB, auth, storage, jobs và payment.
- Data migration/index.
- Security, observability và deployment.
- Admin/backend workflows.

**Product/Full-stack Engineer**

- Kết nối Studio với domain/API/media/template runtime.
- Dashboard, publish/access/QR và các luồng cross-module.
- Test automation cho API/integration/E2E.
- Chia tải frontend hoặc backend theo critical path từng sprint.

**Product Designer**

- User flow, wireframe và UI spec.
- Template storyboard/motion spec.
- Empty/error/loading/accessibility states.
- Design tokens và handoff.

**QA Engineer**

- Test plan, browser/device matrix.
- Exploratory, E2E và regression.
- Payment/access/upload edge cases.
- Release sign-off.

### 4.2. Quy tắc ownership

- Mỗi epic có một owner chịu trách nhiệm cuối.
- Reviewer không phải owner.
- Security-sensitive work cần ít nhất hai người review nếu đội cho phép.
- Template có engineering owner, không chỉ design owner.
- Bug production-blocking được ưu tiên trước feature mới.

### 4.3. Nếu chỉ có một lập trình viên

Không chạy nhiều workstream song song. Thứ tự:

1. Foundation.
2. Gift domain/auth.
3. Media.
4. Viewer + một template.
5. Studio vertical slice.
6. Publish/QR/access.
7. Hai template còn lại.
8. Payment/admin/privacy.
9. Hardening.

Không bắt đầu cả ba template cùng lúc.

---

## 5. Cách tổ chức công việc

### 5.1. Cadence

- Sprint dài 2 tuần.
- Sprint planning: tối đa 90 phút.
- Daily sync: 10–15 phút, tập trung blocker/dependency.
- Mid-sprint demo nội bộ cho luồng đang phát triển.
- Cuối sprint:
  - demo bằng staging;
  - review metric kỹ thuật;
  - retrospective;
  - xác nhận exit criteria.

### 5.2. Kích thước công việc

- Epic: 1–3 sprint.
- Story: hoàn thành trong 1–3 ngày.
- Task: không quá 1 ngày lý tưởng.
- Spike: time-box tối đa 2 ngày, kết thúc bằng quyết định/tài liệu/prototype.
- Bug critical: xử lý ngay.

Story quá 3 ngày phải được chia theo vertical behavior, không chỉ chia “frontend/backend” nếu có thể.

### 5.3. Branch và review

- Trunk-based hoặc short-lived branch.
- PR nhỏ, mục tiêu dưới khoảng 400 dòng logic khi có thể.
- Feature lớn đặt sau feature flag.
- Không merge nếu thiếu test cho logic quan trọng.
- Template artifact chỉ publish khi contract/visual/performance test pass.
- Database migration/index change được review riêng.

### 5.4. Quản lý scope

Ba mức:

- **P0:** bắt buộc cho Paid MVP.
- **P1:** nên có, làm nếu P0 đúng tiến độ.
- **P2:** sau MVP.

Khi trễ:

1. Cắt P1.
2. Giảm polish ngoài critical flow.
3. Giảm số variant/theme.
4. Không cắt security, data integrity, deletion, backup hoặc template compatibility.

---

## 6. Kiến trúc workstream

### 6.1. Workstream A — Product foundation

- Monorepo.
- CI/CD và environments.
- Design tokens/UI primitives.
- Configuration/secrets.
- Feature flags.
- ADR và coding conventions.

### 6.2. Workstream B — Domain/backend

- Gift lifecycle.
- Revision/optimistic concurrency.
- Template registry.
- Access policy.
- Auth/authorization.
- Publish service.
- Order/payment/entitlement.
- Admin/moderation/deletion.

### 6.3. Workstream C — Media platform

- Direct upload.
- Asset state machine.
- Image processing.
- Storage/CDN policy.
- Cleanup.
- Licensed audio catalog.

### 6.4. Workstream D — Studio

- Catalog/detail/demo.
- Schema-driven editor.
- Crop/reorder.
- Autosave/recovery.
- Preview.
- Publish/checkout UX.
- Dashboard.

### 6.5. Workstream E — Viewer/template

- Viewer envelope.
- Unlock flow.
- Template SDK/runtime.
- Audio controller.
- Sandbox/message contract.
- Three templates.
- Reduced motion/fallback.

### 6.6. Workstream F — Quality/operations

- Automated tests.
- Browser/device QA.
- Observability.
- Performance.
- Security.
- Backup/restore.
- Runbooks.

---

## 7. Dependency map và critical path

~~~mermaid
flowchart LR
  F[Foundation & CI] --> D[Gift domain & Auth]
  F --> M[Media pipeline]
  F --> T[Template SDK & Viewer]
  D --> S[Studio & Autosave]
  M --> S
  T --> S
  T --> TP1[Template 1]
  S --> V[Vertical slice]
  TP1 --> V
  V --> P[Publish, Access & QR]
  P --> TP23[Template 2 & 3]
  P --> B[Billing & Entitlement]
  B --> A[Admin, Privacy & Deletion]
  TP23 --> H[Hardening]
  A --> H
  H --> RC[Production-ready]
~~~

Critical path:

1. Foundation.
2. Template manifest/runtime.
3. Media pipeline.
4. Gift draft + Studio.
5. Template số 1.
6. Preview/publish.
7. Payment entitlement.
8. Security/performance/release gate.

Media pipeline và template runtime có thể chạy song song. Template 2–3 chỉ bắt đầu khi template 1 đã chạy end-to-end để tránh nhân ba lỗi kiến trúc.

---

## 8. Các state machine cần chốt sớm

### 8.1. Gift lifecycle

~~~mermaid
stateDiagram-v2
  [*] --> draft
  draft --> readyToPublish: content + assets hợp lệ
  readyToPublish --> publishing: free entitlement hoặc payment verified
  publishing --> scheduled: unlockAt trong tương lai
  publishing --> published: mở ngay
  scheduled --> published: scheduled job / access time
  scheduled --> paused: owner pause
  published --> paused: owner/admin pause
  paused --> published: owner resume và còn entitlement
  published --> expired: expiresAt
  scheduled --> expired: entitlement hết hạn
  expired --> published: renew
  draft --> deleting: owner delete
  paused --> deleting: owner/admin delete
  expired --> deleting: retention job
  deleting --> deleted: metadata + asset cleanup
~~~

Lưu ý:

- readyToPublish có thể là trạng thái dẫn xuất, không nhất thiết persisted.
- scheduled unlock phải được kiểm tra theo server time mỗi request; job chỉ phục vụ transition/notification.
- Nếu scheduler trễ, Viewer vẫn mở đúng khi server thấy unlockAt đã qua.
- deleted là tombstone có retention audit, không đồng nghĩa mọi backup bị xóa tức thì.

### 8.2. Asset lifecycle

~~~mermaid
stateDiagram-v2
  [*] --> initiated
  initiated --> uploaded: browser hoàn thành PUT
  uploaded --> processing: worker claim
  processing --> ready: validate + derivatives thành công
  processing --> rejected: file không hợp lệ
  processing --> failed: lỗi có thể retry
  failed --> processing: retry
  ready --> deleting: gift/delete/retention
  rejected --> deleting
  deleting --> deleted
~~~

### 8.3. Order/payment lifecycle

~~~mermaid
stateDiagram-v2
  [*] --> created
  created --> pendingPayment: checkout tạo thành công
  pendingPayment --> paid: verified webhook/reconciliation
  pendingPayment --> cancelled
  pendingPayment --> expired
  paid --> fulfilling: enqueue finalize publish
  fulfilling --> fulfilled: gift published/scheduled
  fulfilling --> fulfillmentFailed: retry/manual review
  paid --> refundPending
  refundPending --> refunded
~~~

Không cho phép browser returnUrl tự chuyển order thành paid.

---

## 9. Sprint 0 — Foundation và giảm rủi ro

**Thời gian:** Tuần 1–2  
**Mục tiêu:** tạo nền kỹ thuật, UX và bằng chứng cho bốn rủi ro lớn trước khi phát triển tính năng diện rộng.

### 9.1. Product/UX

- Chốt user flow của creator và receiver.
- Chốt information architecture:
  - catalog;
  - template detail/demo;
  - Studio;
  - checkout;
  - dashboard;
  - Viewer;
  - admin.
- Wireframe mobile-first cho happy path và error/loading/empty states.
- Storyboard ba template; template 1 có motion specification chi tiết.
- Chốt field schema template v1.
- Chốt browser/device support.

### 9.2. Engineering foundation

- Tạo pnpm workspace và app/packages.
- Khởi tạo Next.js/TypeScript strict/Tailwind.
- Tạo lint, format, typecheck, unit test và build pipeline.
- Tạo staging/preview configuration.
- Environment schema và secret naming.
- Structured logging/request ID skeleton.
- Feature flag abstraction nhỏ.
- Error boundary/global error page.

### 9.3. Bốn technical spikes

**Spike A — MongoDB/Next.js**

- MongoClient singleton.
- Một health/read/write route.
- Xác minh pool/reuse trên môi trường deploy.

**Spike B — Direct upload**

- API tạo presigned PUT.
- Browser upload một ảnh.
- Worker hoặc script xử lý Sharp.
- Trả derivative để render.

**Spike C — Template isolation**

- Một iframe/template artifact tối giản.
- postMessage init/play/complete.
- CSP/sandbox.
- Test destroy/reload.

**Spike D — Mobile audio**

- Tap to open.
- Audio play/pause/mute trên Safari iOS/Chrome Android/in-app browser mẫu.
- Fallback khi play Promise bị reject.

### 9.4. ADR cần hoàn tất

- Next.js App Router + BFF.
- MongoDB Atlas.
- Official MongoDB driver.
- Object storage.
- Template isolation/version.
- Auth library.
- Job runner.
- Payment boundary.

### 9.5. Deliverables

- Repo build được.
- Preview environment hoạt động.
- CI bắt lỗi type/lint/test/build.
- Wireframe và template storyboard được duyệt.
- Bốn spike có kết luận bằng văn bản.
- Backlog sprint 1–3 được refine.

### 9.6. Exit criteria

- Không còn unknown lớn về upload, iframe hoặc audio.
- Browser baseline được ghi trong tài liệu.
- Template schema v1 đủ biểu diễn template đầu tiên.
- Team có thể deploy một route và rollback.
- Không bắt đầu feature nếu spike template/audio thất bại mà chưa có fallback.

---

## 10. Sprint 1 — Core domain, database và authentication

**Thời gian:** Tuần 3–4  
**Mục tiêu:** có creator identity, gift draft versioned và template registry.

### 10.1. Database

- Tạo collections:
  - users/auth collections;
  - templates;
  - templateVersions;
  - gifts;
  - giftRevisions;
  - assets skeleton;
  - idempotencyKeys;
  - jobOutbox.
- Tạo schema validators cho document envelope.
- Tạo index migration.
- Seed ba template metadata và fixture.
- Repository interfaces.

### 10.2. Gift domain

- Gift state machine.
- Create anonymous draft.
- Claim draft vào owner.
- Update draft bằng optimistic concurrency:
  - client gửi expected revision;
  - server update khi revision khớp;
  - conflict trả error có cấu trúc.
- Tạo gift revision.
- Validate content theo template schema/version.
- Không cho client tự đổi owner/template version tùy ý.

### 10.3. Authentication

- Better Auth + MongoDB adapter.
- Passwordless email flow.
- Session cookie configuration.
- Rate limit auth endpoint.
- DAL verifySession/getCurrentUser.
- Authorization helper owner/admin.
- Anonymous draft claim token.
- Logout/session expiry.

### 10.4. Frontend

- Catalog skeleton dùng seed template.
- Template detail route.
- Create draft CTA.
- Studio shell với step navigation.
- Auth modal/page.
- Error/loading/empty states.

### 10.5. Test

- Gift state unit tests.
- Schema validation tests.
- Optimistic concurrency integration test.
- Claim draft authorization tests.
- Auth smoke E2E.
- Index existence test.

### 10.6. Deliverables

- User đăng nhập passwordless.
- User/anonymous tạo draft.
- Draft claim được vào tài khoản.
- Draft update/revision hoạt động.
- Catalog đọc từ template registry.

### 10.7. Exit criteria

- Không thể đọc/sửa gift của owner khác qua API.
- Conflict không làm mất nội dung âm thầm.
- Database setup có thể tái tạo ở staging.
- Auth test pass và token không xuất hiện trong log.

---

## 11. Sprint 2 — Media pipeline và Viewer runtime

**Thời gian:** Tuần 5–6  
**Mục tiêu:** media an toàn đi từ browser đến derivative; Viewer có thể render một template artifact.

Hai nhánh có thể chạy song song.

### 11.1. Media platform

- Asset state machine.
- Upload init:
  - auth/anonymous quota;
  - file type/declared size;
  - random object key;
  - presigned URL TTL ngắn.
- Upload complete:
  - ownership;
  - head object;
  - enqueue process.
- Worker Sharp:
  - MIME sniff/decode;
  - pixel/byte limit;
  - auto-orient;
  - EXIF/GPS removal;
  - derivatives;
  - placeholder;
  - checksum.
- Reject/failed/retry path.
- Orphan cleanup.
- Private/published storage policy.
- Asset status API.

### 11.2. Studio media UI

- Multi-image picker.
- Upload progress/cancel/retry.
- Crop theo aspect slot.
- Reorder.
- Processing status.
- Error cho file không hợp lệ.
- Không cho publish khi asset chưa ready.
- Recovery sau reload.

### 11.3. Template SDK/runtime

- Manifest Zod schema.
- Runtime types.
- Build command tạo:
  - ESM artifact;
  - content hash;
  - manifest output;
  - build metadata.
- Viewer shell.
- Sandbox iframe.
- postMessage schema.
- Lifecycle mount/play/pause/destroy.
- Runtime asset resolver.
- Audio controller.
- reduced-motion context.
- Scene event collector.

### 11.4. Template test harness

- Fixture loader.
- Max-length/missing-field cases.
- Viewport switch.
- reduced-motion switch.
- performance counters.
- screenshot helper.
- unexpected network detector.

### 11.5. Deliverables

- Một ảnh upload thành derivative và hiển thị lại.
- Viewer tải template artifact theo exact version.
- Template fixture có thể play/pause/destroy.
- Audio chỉ bắt đầu sau thao tác người dùng.

### 11.6. Exit criteria

- Không có binary/base64 trong gift document.
- EXIF/GPS không còn ở derivative.
- Upload retry không tạo asset trùng ngoài kiểm soát.
- Template không đọc session/app storage.
- Tab hidden pause animation.
- Worker failure quan sát được và retry được.

---

## 12. Sprint 3 — Vertical slice với Template 1

**Thời gian:** Tuần 7–8  
**Mục tiêu:** hoàn thành một gift “Hộp ký ức” end-to-end trên staging.

### 12.1. Schema-driven Studio

- Generate field theo manifest:
  - short text;
  - long text;
  - image list;
  - theme enum;
  - licensed audio;
  - date.
- Group field thành step.
- Client/server validation.
- Character/asset count.
- Field-level error.
- Zustand editor orchestration.
- Debounced autosave.
- Offline/failed save indicator.
- Unsaved navigation warning.
- Conflict resolution UX tối thiểu.

### 12.2. Preview

- Dùng cùng template artifact và payload transformer với Viewer.
- Preview token ngắn hạn.
- Mobile/desktop viewport.
- Jump từ scene lỗi về field.
- Restart/mute/reduced-motion.
- Không publish preview URL.

### 12.3. Template 1 — Hộp ký ức

- Cover và tap to open.
- Hộp/nơ transition.
- 3–8 ảnh theo thứ tự.
- Caption từng ảnh.
- Thư cuối.
- Theme variants tối thiểu.
- Audio controller integration.
- Loading/fallback.
- Reduced-motion.
- Error boundary.

### 12.4. Temporary publish

Để chứng minh vertical slice, có thể dùng internal/free entitlement:

- Prepare snapshot.
- Tạo publicId.
- Viewer envelope/payload.
- URL staging.
- Chưa cần payment hoặc QR hoàn chỉnh.

### 12.5. Test

- E2E create → upload → customize → preview → internal publish → open.
- Visual snapshot các scene.
- Text/emoji/ảnh edge cases.
- Safari/Chrome mobile exploratory.
- Cold-cache performance baseline.

### 12.6. Deliverables

- Một người không thuộc đội kỹ thuật tạo được gift thật trên staging.
- Một người khác mở được bằng anonymous browser.
- Gift gắn template version bất biến.
- Analytics event cơ bản đi hết funnel.

### 12.7. Exit criteria — Gate M2

- Happy path hoàn thành không cần can thiệp database.
- Content preview và published giống nhau.
- Template lỗi không làm mất nội dung cốt lõi.
- Có kết quả performance và danh sách issue thực tế.
- Không bắt đầu Template 2–3 nếu gate này chưa đạt.

---

## 13. Sprint 4 — Ba template, publish, access và QR

**Thời gian:** Tuần 9–10  
**Mục tiêu:** tạo Free Pilot Candidate hoàn chỉnh về nội dung và quyền truy cập.

### 13.1. Publish service

- Prepare-publish validation.
- Kiểm tra:
  - owner;
  - template version;
  - schema;
  - asset ready/ownership;
  - entitlement;
  - access config.
- Immutable content snapshot.
- Idempotency key.
- Transaction + outbox.
- Publishing error/retry.
- Publish revision mới khi owner sửa.
- Pause/resume.

### 13.2. Access policy

- Unlisted.
- Password:
  - hash;
  - attempt rate limit;
  - unlock session/challenge;
  - generic error.
- Scheduled:
  - timezone;
  - server-time access;
  - countdown envelope;
  - job notification không quyết định access.
- Expired/paused/deleted states.
- Generic OG metadata.

### 13.3. QR/share

- Public URL format.
- QR PNG.
- QR SVG.
- Download/copy.
- Web Share API với fallback.
- Print test kích thước mục tiêu.
- Bot/social preview classification tối thiểu.
- Không đếm preview crawler là opened.

### 13.4. Template 2 — Dòng thời gian

- 4–7 milestone.
- Scroll/tap navigation.
- Progress.
- Caption/date/photo.
- Final scene.
- Reduced-motion và long-text behavior.

### 13.5. Template 3 — Bầu trời lời nhắn

- Canvas 2D star field.
- Tap star reveal.
- Firework finale.
- DOM fallback.
- Device capability scaling.
- Reduced-motion.

### 13.6. Dashboard creator tối thiểu

- Gift list.
- Draft/published/scheduled/paused/expired status.
- Copy URL/download QR.
- Edit/pause/resume/delete.
- Human-open status ở mức privacy-safe.

### 13.7. Test

- Template contract suite cho cả ba.
- Password brute-force/rate-limit.
- Schedule timezone/client clock wrong.
- Bot preview.
- QR scan device/print.
- Publish retry/concurrency.
- Gift version compatibility.

### 13.8. Deliverables

- Ba template usable.
- Creator quản lý được gift.
- Mọi access mode hoạt động.
- QR và share hoàn chỉnh.
- Free entitlement chạy.

### 13.9. Exit criteria — Gate M3

- 20 gift test nội bộ có thể tạo/mở.
- Không có template P0 defect.
- Viewer fatal error dưới ngưỡng test chấp nhận.
- Access policy không thể bypass qua payload endpoint.
- QR quét được trên matrix thiết bị đã chọn.

---

## 14. Sprint 5 — Payment, entitlement và background workflows

**Thời gian:** Tuần 11–12  
**Mục tiêu:** Paid MVP Candidate có luồng thanh toán và fulfillment tin cậy.

### 14.1. Pricing/entitlement domain

- Plan/Product snapshot.
- Free vs paid capability.
- Gift entitlement:
  - max photos;
  - template availability;
  - watermark;
  - retention;
  - password/schedule.
- Không hardcode plan check rải rác trong UI.
- Server là source of truth.

### 14.2. Order/payment

- Order state machine.
- BillingProvider.
- payOS adapter.
- Create checkout.
- Return/cancel page.
- Verified webhook.
- Signature verification.
- Idempotent event handling.
- Amount/currency/order reconciliation.
- Provider polling/reconciliation job.
- Refund/admin status model; chưa cần tự động refund UI nếu provider/business chưa chốt.

### 14.3. Publish sau payment

Luồng đề xuất:

1. User nhấn publish.
2. Server validate và lưu prepared snapshot.
3. Server tạo order + checkout.
4. User thanh toán.
5. Verified webhook chuyển order thành paid.
6. Transaction cấp entitlement + outbox finalizePublish.
7. Worker publish/schedule gift.
8. Return page poll trạng thái, không tự xác nhận paid.

Nếu browser đóng sau thanh toán, webhook vẫn hoàn tất.

### 14.4. Background jobs

- media.process hoàn thiện.
- publish.finalize.
- schedule.notification.
- gift.expire.
- asset.cleanup.
- email.send.
- payment.reconcile.
- outbox dispatcher.
- Dead-letter/manual retry.
- Job dashboards/alerts.

### 14.5. Email hệ thống

- Verify/magic link.
- Payment received.
- Gift published.
- Scheduled reminder.
- Processing failed cần hành động.
- Owner delete confirmation.

Email không chứa full private gift content.

### 14.6. Test

- Provider contract stub.
- Webhook invalid signature.
- Duplicate/out-of-order webhook.
- Return URL giả.
- Paid nhưng finalize lỗi rồi retry.
- Amount mismatch.
- Browser đóng trước return.
- Order expired/cancelled.
- Email retry/idempotency.

### 14.7. Exit criteria — Gate M4

- Không có đường client-side tự cấp paid entitlement.
- Duplicate webhook không tạo side effect lặp.
- Payment thành công cuối cùng tạo được published/scheduled gift dù browser đã đóng.
- Manual support có thể thấy order/fulfillment status.

---

## 15. Sprint 6 — Admin, privacy, deletion và security

**Thời gian:** Tuần 13–14  
**Mục tiêu:** Release Candidate đủ khả năng vận hành và xử lý dữ liệu/nguy cơ cơ bản.

### 15.1. Admin

- Admin auth + MFA.
- Role/permission.
- Search bằng internal/public ID, không search nội dung riêng tư rộng mặc định.
- Template version:
  - draft;
  - publish;
  - retire;
  - kill switch.
- Gift:
  - status;
  - pause;
  - report context;
  - audit.
- Asset processing status/retry.
- Order/payment/fulfillment view.
- User deletion request status.

### 15.2. Report/takedown

- Public report form.
- Category/severity.
- AbuseReport state.
- Rate limit/anti-spam.
- Admin review queue.
- Pause/takedown.
- Owner notification template.
- Audit trail.
- Emergency flow cho nội dung nghiêm trọng.

### 15.3. Privacy/deletion

- Privacy consent UI.
- Upload rights confirmation.
- Retention labels.
- Owner export metadata/content cơ bản.
- Delete request.
- Deletion orchestration:
  - revoke access;
  - delete published derivative;
  - delete originals;
  - purge/revalidate cache;
  - remove/anonymize events;
  - delete domain documents theo policy;
  - retain tối thiểu payment/audit theo nghĩa vụ đã xác định.
- Deletion status/audit.
- Draft/orphan retention.

### 15.4. Security hardening

- CSP.
- HSTS/security headers.
- CSRF.
- Session/cookie review.
- Rich-text sanitization.
- SVG/file upload policy.
- Rate-limit coverage.
- Admin audit.
- Secret scan/dependency scan.
- Broken access control test.
- Sensitive log review.
- Provider credential rotation procedure.

### 15.5. Backup/restore preparation

- Backup policy.
- Object lifecycle/versioning.
- Restore staging procedure.
- Data reconciliation script.
- Runbook owner và expected RPO/RTO.

### 15.6. Test

- IDOR/broken ownership.
- XSS payload trong mọi text field.
- Password/access bypass.
- Upload polyglot/bad MIME/oversized pixel.
- Delete while processing/viewing.
- Report spam.
- Admin authorization.
- Template kill switch.
- Log/analytics PII audit.

### 15.7. Exit criteria — Gate M5

- Critical/high security issue đã đóng hoặc có approved mitigation.
- User có thể pause/delete không cần can thiệp trực tiếp database.
- Admin xử lý report từ đầu đến cuối.
- Template lỗi có thể retire/kill.
- Deletion flow chạy end-to-end trên staging.

---

## 16. Sprint 7 — Hardening và production readiness

**Thời gian:** Tuần 15–16  
**Mục tiêu:** giảm defect, chứng minh khả năng phục hồi và đạt release gate; không thêm feature mới nếu không cần để đóng P0.

### 16.1. Regression

- Chạy full E2E.
- Exploratory theo persona.
- Cross-browser/device.
- In-app browser.
- Mạng yếu/cache lạnh.
- Conflict/multi-tab.
- Payment chaos cases.
- Scheduled unlock tại mốc thời gian thật.
- Delete/expire/cache behavior.

### 16.2. Performance

- Đo từng template:
  - JS initial;
  - media initial;
  - LCP;
  - INP;
  - CLS;
  - CPU/FPS;
  - memory;
  - battery/heat quan sát.
- Lazy scene media.
- Image size/crop tuning.
- Canvas particle/device scaling.
- Pause hidden tab.
- Remove unused dependencies.
- CDN/cache header review.

### 16.3. Reliability

- Load test Viewer envelope/payload.
- Load test upload-init/publish trong phạm vi dự kiến.
- Job retry/dead-letter drill.
- Payment webhook burst/replay.
- Mongo connection/pool monitoring.
- Provider outage behavior.
- Asset missing/corrupt fallback.
- Idempotency retention review.

### 16.4. Recovery drills

- Restore Mongo backup vào isolated staging.
- Reconcile restored metadata với object storage sample.
- Rollback web deploy.
- Rollback template registry pointer.
- Kill one template version.
- Replay safe outbox/job.
- Rotate one non-production credential.

### 16.5. Accessibility

- Keyboard navigation Studio.
- Screen-reader labels/error announcement.
- Focus management modal/step.
- Color contrast.
- Reduced-motion toàn Viewer.
- Pause/mute control.
- Content readable khi animation off.

### 16.6. Documentation

- Architecture overview.
- Local setup.
- Environment/secrets.
- Migration/index.
- Template authoring.
- Payment incident.
- Media failure.
- Report/takedown.
- Delete request.
- Backup/restore.
- Release/rollback.
- Known limitations/browser policy.

### 16.7. Release criteria — Gate M6

- Full P0 complete.
- P1 chưa hoàn thành được đưa khỏi release scope.
- Không critical/blocker defect.
- High defects có owner và được Product/Tech chấp thuận nếu defer.
- Critical E2E pass ổn định.
- Browser matrix sign-off.
- Performance budget sign-off cho ba template.
- Security checklist sign-off.
- Restore/rollback drill thành công.
- Monitoring/alert hoạt động.
- Runbook và on-call owner được chỉ định.

---

## 17. Backlog theo module và mức ưu tiên

### 17.1. Catalog

**P0**

- List template.
- Filter theo occasion/mood.
- Template detail.
- Demo bằng fixture.
- Input requirements/time estimate.

**P1**

- Recently viewed.
- Recommendation theo số ảnh/thời gian.
- Favorite.

**P2**

- Personalization/recommendation engine.

### 17.2. Studio

**P0**

- Schema form.
- Text/date/image/theme/audio.
- Crop/reorder.
- Validation.
- Autosave/recovery.
- Preview.
- Publish/checkout state.

**P1**

- Undo last content changes.
- Duplicate gift.
- Better conflict merge.
- Guided story prompts nâng cao.

**P2**

- Drag-drop layout.
- Multi-user collaboration.

### 17.3. Viewer

**P0**

- Envelope.
- Tap to open.
- Payload access.
- Audio controls.
- Pause/replay.
- Reduced-motion.
- Fallback/error.
- Scene completion.

**P1**

- Reaction emoji/text.
- Save-to-home hint.
- Resume scene.

**P2**

- Voice reaction.
- Co-create memory.

### 17.4. Template platform

**P0**

- Manifest/schema.
- Version/artifact hash.
- Runtime contract.
- Sandbox.
- Fixture/harness.
- Contract/visual/performance tests.
- Three internal templates.

**P1**

- CLI authoring.
- Local template playground.
- Automated migration runner.

**P2**

- Submission/review/royalty marketplace.

### 17.5. Gift management

**P0**

- List/detail.
- Edit/re-publish revision.
- Copy link/QR.
- Pause/resume.
- Delete.
- Status/open indicator.

**P1**

- Duplicate/renew.
- Export.
- Detailed privacy-safe insights.

**P2**

- Couple memory vault.

### 17.6. Billing

**P0**

- Product/price snapshot.
- Checkout.
- Webhook.
- Entitlement.
- Reconciliation.
- Admin status.

**P1**

- Coupon.
- Self-service receipt.
- Automated refund nếu provider cho phép.

**P2**

- Subscription.
- Multi-provider routing.
- Partner credit/royalty.

### 17.7. Admin/privacy

**P0**

- Template lifecycle.
- Gift pause/takedown.
- Report queue.
- Payment/asset status.
- Deletion request.
- Audit.

**P1**

- Operation dashboard.
- Bulk cleanup/retry.

**P2**

- Advanced moderation automation.

---

## 18. API và data implementation plan

### 18.1. API implementation order

1. Auth/session.
2. Template catalog.
3. Gift draft CRUD + revision.
4. Upload init/complete/status.
5. Preview token.
6. Viewer envelope/payload/unlock.
7. Prepare/finalize publish.
8. QR/share.
9. Checkout/webhook/order status.
10. Dashboard actions.
11. Report/admin/deletion.

### 18.2. Contract rules

- Zod schema cho request/response.
- DTO không lộ Mongo field nội bộ.
- Error code ổn định.
- Request ID.
- Pagination cursor, không offset khi collection lớn.
- Idempotency header/key cho publish, checkout và destructive action.
- API mutation kiểm tra authz tại DAL.
- Public endpoint không trả khác biệt giúp enumerate gift/user.

### 18.3. Index migration plan

- Index nằm trong source control.
- Migration có version và checksum.
- CI/staging chạy trước production.
- Unique index kiểm tra duplicate data trước khi tạo.
- Không tự động drop index production.
- Query quan trọng có explain review khi có dữ liệu đại diện.

### 18.4. Seed/fixture

- Ba template metadata.
- Ba gift fixture chuẩn.
- Max-length/emoji fixture.
- Missing optional fields.
- Scheduled/password/expired fixture.
- Payment states.
- Abuse report states.
- Demo media không có dữ liệu cá nhân thật.

### 18.5. Data deletion verification

Sau delete job cần kiểm tra:

- gift payload trả unavailable;
- asset public/private object không còn truy cập;
- CDN cache được purge/expired;
- reactions/events xử lý theo policy;
- auth/user data xử lý đúng phạm vi;
- payment/audit retention tách biệt;
- deletion audit không chứa content đã xóa.

---

## 19. Test strategy và chất lượng

### 19.1. Automated coverage tập trung

Không đặt mục tiêu coverage phần trăm chung chung. Bắt buộc test những invariant:

- ownership;
- gift/order/asset state machine;
- template schema;
- revision conflict;
- access unlock;
- payment idempotency;
- publish atomicity/outbox;
- expiration/deletion;
- manifest/runtime contract.

### 19.2. Browser matrix ban đầu

Tối thiểu:

- Safari iOS trên một thiết bị cũ còn trong support policy và một thiết bị mới.
- Chrome Android trên thiết bị tầm trung.
- Android WebView/in-app browser của kênh chia sẻ mục tiêu.
- Chrome/Edge desktop.
- Firefox desktop.
- Safari macOS nếu có khả năng kiểm thử.

Matrix chính xác chốt ở Sprint 0 dựa trên target user; không chỉ dùng emulator.

### 19.3. Test data

- Dữ liệu giả có dấu tiếng Việt.
- Ảnh portrait, landscape, HEIC/JPEG/PNG/WebP.
- File sai MIME, corrupt, quá byte/pixel.
- Text dài, emoji, HTML/XSS.
- Timezone Asia/Ho_Chi_Minh và khác múi giờ.
- Bot user-agent.
- Network offline/slow.
- Duplicate webhook/job.

### 19.4. Bug severity

**Blocker**

- mất dữ liệu;
- charge sai/nhân đôi;
- lộ gift/private asset;
- không thể publish/open trên browser chính;
- không rollback/khôi phục.

**Critical**

- bypass password/schedule;
- template crash diện rộng;
- asset người A gắn vào gift người B;
- deletion không thu hồi public access;
- payment thành công nhưng không có đường recovery.

**High**

- flow chính cần workaround;
- Viewer lỗi trên một browser support;
- performance phá trải nghiệm;
- accessibility chặn nhóm người dùng.

**Medium/Low**

- polish, copy, visual lệch nhỏ, edge case có workaround.

### 19.5. Defect exit policy

- 0 blocker.
- 0 critical.
- High phải có quyết định defer rõ, owner và thời hạn.
- Không đo “bug count” đơn thuần; theo escaped defect, reopen rate và defect theo template/version.

---

## 20. Security và privacy work plan

### 20.1. Threat modeling ở Sprint 0–1

Threat actors/use cases:

- người đoán/enumerate public URL;
- người có link chia sẻ lại;
- attacker brute-force password;
- owner cố gắn asset không thuộc họ;
- XSS qua text/rich text/SVG/template;
- fake payment callback/webhook;
- bot spam reaction/report/upload;
- admin account compromise;
- nội dung không đồng thuận.

Assets cần bảo vệ:

- gift content;
- owner identity;
- original media;
- payment state;
- admin capability;
- provider secrets;
- template supply chain.

### 20.2. Security checkpoints

- Sprint 0: threat model + CSP spike.
- Sprint 1: auth/session/IDOR review.
- Sprint 2: upload/media/template sandbox review.
- Sprint 4: access policy/QR/bot review.
- Sprint 5: payment/webhook review.
- Sprint 6: full security checklist.
- Sprint 7: targeted penetration/exploratory test và dependency patch.

### 20.3. Privacy checkpoints

- Data inventory.
- Purpose/retention table.
- Analytics redaction.
- EXIF stripping verification.
- Consent copy.
- Report/delete/export.
- Backup deletion expectations.
- Third-party provider inventory.

Không đợi sprint cuối mới “thêm privacy”.

---

## 21. Performance budget

### 21.1. Viewer shell

Mục tiêu ban đầu:

- HTML/CSS cover usable ngay.
- Không tải Studio/admin code.
- Không tải Three.js/Lottie nếu template không cần.
- Không tải toàn bộ ảnh trước khi người nhận mở.
- Generic OG route không fetch private payload.

### 21.2. Template budget

Mỗi manifest khai báo:

- initial JS gzip;
- initial image bytes;
- total scene media;
- texture memory;
- target FPS/device tier;
- max particle;
- reduced-motion mode.

Budget cụ thể được thiết lập sau spike/template 1, sau đó template 2–3 phải tuân thủ.

### 21.3. Performance gate

- Lighthouse CI chỉ là signal.
- Quyết định dựa thêm trên thiết bị thật và Web Vitals.
- Visual đẹp không phải lý do miễn performance gate.
- Template vượt budget phải được tối ưu hoặc xếp premium/high-device với fallback rõ.

---

## 22. Observability và runbook plan

### 22.1. Dashboard tối thiểu

- Viewer request/error theo template version.
- Gift publish success/failure.
- Asset queue latency/failure.
- Order/payment/fulfillment mismatch.
- Email auth delivery.
- Mongo connection/query latency.
- Job retry/dead-letter.
- Delete request SLA.

### 22.2. Runbook bắt buộc

- Viewer 5xx tăng.
- Một template crash.
- Asset processing backlog.
- Payment webhook ngừng đến.
- Payment paid nhưng gift chưa publish.
- MongoDB unavailable/high connection.
- R2/CDN asset unavailable.
- Magic link email không đến.
- Báo cáo nội dung khẩn cấp.
- Xóa dữ liệu bị kẹt.
- Credential bị lộ.
- Rollback app/template.
- Restore database.

### 22.3. Mỗi alert cần

- Điều kiện.
- Severity.
- Owner.
- Link dashboard/log.
- Bước xác minh.
- Safe mitigation.
- Escalation.
- Cách đóng incident.

Alert không có owner/runbook chỉ tạo tiếng ồn.

---

## 23. Ước lượng khối lượng

Đây là ước lượng phạm vi, không phải cam kết lịch. Độ bất định cao nhất nằm ở template animation, in-app browser, media processing và payment/provider.

| Workstream | Person-days ước lượng |
|---|---:|
| Product/UX flow và design system | 15–22 |
| Foundation, monorepo, CI, environments | 10–15 |
| Gift domain, MongoDB và auth | 20–28 |
| Media upload/processing/storage | 18–26 |
| Template SDK/runtime/sandbox | 20–30 |
| Ba template | 30–45 |
| Studio/editor/preview | 28–40 |
| Publish/access/QR/dashboard | 20–28 |
| Payment/entitlement/jobs/email | 18–26 |
| Admin/moderation/privacy/deletion | 18–28 |
| Test automation/cross-browser/performance/security | 30–45 |
| Documentation/recovery/release hardening | 10–16 |
| **Tổng** | **237–349 person-days** |

Một phần công việc design/QA chạy song song và một số hạng mục dùng chung. Timeline theo đội:

| Đội hình | Thời gian hợp lý |
|---|---:|
| 1 senior full-stack kiêm animation/design/QA | 40–52 tuần |
| 2 engineers + design/QA part-time | 20–24 tuần |
| 3 engineers + designer + QA part-time/full-time | 14–18 tuần |
| 4+ engineers | Không tự động dưới 12 tuần vì dependency và hardening |

Kế hoạch 16 tuần là mục tiêu hợp lý với 3 engineers, design/QA hỗ trợ đúng thời điểm, phạm vi P0 được giữ chặt và template không vượt độ phức tạp đã giả định.

### 23.1. Contingency

Dành 15–20% capacity cho:

- browser differences;
- provider integration;
- media formats;
- performance optimization;
- bug/rework sau test thật.

Không dùng contingency để thêm feature.

---

## 24. Rủi ro thực thi

| Rủi ro | Xác suất | Tác động | Dấu hiệu sớm | Giảm thiểu |
|---|---|---|---|---|
| Ba template chạy song song trước khi runtime ổn | Cao | Cao | Cùng lỗi lặp ở ba codebase | Chỉ Template 1 trước gate M2 |
| Studio và Viewer render khác nhau | Trung bình | Cao | Preview đúng, publish sai | Dùng cùng artifact/payload transformer |
| Media edge case tiêu tốn thời gian | Cao | Cao | HEIC/corrupt/ảnh lớn lỗi | Spike sớm, giới hạn rõ, worker re-encode |
| Mongo schema trở nên tùy tiện | Trung bình | Cao | Field/invariant rải rác | Zod + DB validator + repository + migrations |
| Payment race/duplicate | Trung bình | Rất cao | Đơn paid nhưng state lệch | Idempotency, transaction, outbox, reconciliation |
| Template làm Viewer nặng | Cao | Cao | JS/media tăng qua mỗi mẫu | Artifact riêng, budget, dynamic import/CDN |
| In-app browser chặn audio/API | Cao | Cao | Test desktop pass, user fail | Device spike Sprint 0, fallback |
| Privacy bị để đến cuối | Trung bình | Rất cao | Không xóa hết asset/cache | Data inventory/lifecycle từ Sprint 1–2 |
| Scope creep | Cao | Cao | P1 vào sprint trước P0 | Scope owner, gates, feature flags |
| Solo bottleneck review/QA | Cao nếu solo | Cao | Bug lặp, chậm hardening | Automated tests, external review theo milestone |
| Managed provider outage/lock-in | Thấp–TB | Cao | Không có adapter/export | Port nhỏ, retries, runbook, data export |
| Thiếu license cho nhạc/asset | Trung bình | Cao | Không có provenance | Licensed catalog và registry trước paid MVP |

---

## 25. Definition of Ready

Một story chỉ vào sprint khi:

- Có user/problem statement.
- Có acceptance criteria.
- Có design hoặc xác nhận không cần design.
- Dependency được xác định.
- API/data/security impact được ghi.
- Test approach được nêu.
- Scope đủ nhỏ.
- Không còn câu hỏi quyết định có thể làm thay đổi hơn 50% implementation.

Template story cần thêm:

- manifest/schema;
- storyboard;
- fixture;
- input limits;
- reduced-motion behavior;
- performance budget;
- fallback.

---

## 26. Definition of Done

Một story được Done khi:

- Acceptance criteria pass.
- Code review hoàn tất.
- Typecheck/lint/test pass.
- Error/loading/empty/unauthorized state được xử lý.
- Authz/validation tại server nếu có mutation.
- Không log dữ liệu nhạy cảm.
- Analytics/observability thêm đúng taxonomy nếu cần.
- Documentation/ADR/API contract cập nhật.
- Deploy staging và QA xác nhận.
- Accessibility cơ bản kiểm tra.
- Không để TODO thay thế behavior P0.

Một template chỉ Done khi:

- Contract suite pass.
- Visual snapshots pass.
- Browser matrix chính pass.
- reduced-motion/fallback pass.
- Không network call ngoài allowlist.
- Performance budget pass.
- Artifact version/content hash được tạo.

---

## 27. Release checklist kỹ thuật

### Product flow

- [ ] Anonymous draft hoạt động.
- [ ] Claim draft không mất dữ liệu.
- [ ] Upload/crop/reorder/retry hoạt động.
- [ ] Ba template preview và publish giống nhau.
- [ ] Free và paid entitlement đúng.
- [ ] QR PNG/SVG quét được.
- [ ] Unlisted/password/scheduled đúng.
- [ ] Pause/resume/delete đúng.
- [ ] Viewer không cần login.

### Data/security

- [ ] Ownership/IDOR test pass.
- [ ] Password/magic token không log.
- [ ] EXIF/GPS được strip.
- [ ] Rich text/XSS test pass.
- [ ] CSP/security headers pass.
- [ ] Admin MFA và audit.
- [ ] Webhook signature/idempotency pass.
- [ ] Data retention/deletion pass.
- [ ] Backup/restore drill pass.

### Reliability

- [ ] Worker retry/dead-letter.
- [ ] Payment reconciliation.
- [ ] Mongo connection monitoring.
- [ ] Provider outage behavior.
- [ ] App/template rollback.
- [ ] Template kill switch.
- [ ] Alerts và runbook.

### Quality

- [ ] Critical E2E pass.
- [ ] Browser/device matrix sign-off.
- [ ] Reduced-motion/accessibility.
- [ ] Performance budget.
- [ ] No blocker/critical defect.
- [ ] Known limitations documented.

---

## 28. Kế hoạch 10 ngày làm việc đầu tiên

### Ngày 1

- Kickoff.
- Chốt MVP/non-goals.
- Chốt team ownership.
- Tạo risk register.

### Ngày 2

- Creator/receiver flow.
- Browser matrix.
- Gift/template terminology.
- Chốt template 1.

### Ngày 3

- Monorepo/Next/CI.
- Environment schema.
- Preview deployment.

### Ngày 4

- MongoClient/repository spike.
- Gift envelope/schema draft.
- Index plan v0.

### Ngày 5

- R2 signed upload spike.
- Sharp derivative.
- Ghi kết quả/giới hạn.

### Ngày 6

- Template manifest/runtime types.
- Artifact build spike.

### Ngày 7

- iframe sandbox/postMessage.
- CSP spike.

### Ngày 8

- Mobile audio/autoplay test.
- Reduced-motion/fallback.

### Ngày 9

- Wireframe Studio/Viewer.
- Storyboard Hộp ký ức.
- Backlog breakdown Sprint 1–3.

### Ngày 10

- Demo bốn spike.
- Chốt ADR.
- Điều chỉnh estimate/risk.
- Go/no-go vào Sprint 1.

---

## 29. Quy tắc ra quyết định trong quá trình phát triển

Khi có hai phương án:

1. Ưu tiên phương án giữ đúng dữ liệu và quyền truy cập.
2. Sau đó ưu tiên Viewer nhanh/ổn trên mobile.
3. Sau đó ưu tiên đơn giản trong vận hành.
4. Sau đó mới ưu tiên abstraction/mở rộng tương lai.

Khi cần cắt scope:

- Cắt số theme.
- Cắt animation phụ.
- Cắt P1 reaction/export/duplicate.
- Cắt dashboard insight chi tiết.
- Không cắt:
  - access control;
  - payment correctness;
  - deletion;
  - template version;
  - asset validation;
  - backup/rollback;
  - critical browser fallback.

Khi một thư viện mới được đề xuất:

- Đo bundle.
- Kiểm tra license.
- Kiểm tra maintenance/security.
- Xác định có nằm trong Viewer shell không.
- Chứng minh browser/platform API không đủ.
- Scope nó trong template nếu chỉ một mẫu cần.

---

## 30. Kết luận

Kế hoạch nên được triển khai như một chuỗi vertical milestones, không phải các đội xây riêng frontend, backend và animation rồi ghép ở cuối.

Thứ tự đúng là:

> **Foundation → gift domain/auth → media + template runtime → một vertical slice → ba template + publish/access/QR → payment/jobs → admin/privacy/security → hardening.**

Ba nguyên tắc giữ dự án trong tầm kiểm soát:

1. **Một template end-to-end trước ba template.**
2. **Một modular monolith đúng boundary trước microservices.**
3. **Production readiness là một phần của phát triển, không phải việc làm sau khi xong feature.**

Nếu đội hình hoặc phạm vi thực tế khác giả định, hãy giữ dependency/gate trong tài liệu và điều chỉnh số sprint; không nên bỏ gate M2, M4 và M6 để “rút ngắn” lịch.
