# LoveMemory — Định hướng tech stack và kiến trúc kỹ thuật

> Phiên bản: 15/09/2026  
> Phạm vi: MVP → paid beta → giai đoạn tăng trưởng ban đầu  
> Đầu vào sản phẩm: [idea.md](./idea.md)

## 1. Kết luận đề xuất

Stack dự định ban đầu là **React/Next.js + Tailwind CSS + MongoDB** phù hợp với LoveMemory, với điều kiện không hiểu nó theo cách “Next.js làm tất cả và MongoDB lưu tất cả”.

Kiến trúc nên chốt như sau:

| Lớp | Lựa chọn đề xuất | Vai trò |
|---|---|---|
| Runtime | Node.js 24 LTS | Runtime thống nhất cho web, tooling và background jobs |
| Ngôn ngữ | TypeScript strict | Chia sẻ type giữa form schema, API, database và template SDK |
| Web framework | Next.js 16, App Router, bản vá 16.x mới nhất | Marketing, catalog, Studio, Viewer shell, dashboard và BFF |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui/Radix primitives | UI sản phẩm; token qua CSS variables |
| Form/validation | React Hook Form + Zod | Form động theo schema và runtime validation |
| Client state | Zustand | State của editor/preview; không dùng Redux ở MVP |
| Animation | CSS/WAAPI + Motion; Canvas 2D; Three.js/R3F chỉ theo template | Phân tầng animation theo độ phức tạp |
| Database | MongoDB Atlas + official Node.js driver | Metadata, gift snapshots, revisions, template registry, orders |
| Media | Cloudflare R2 hoặc S3-compatible storage + CDN | Ảnh, audio, thumbnail và template bundle |
| Auth | Better Auth + MongoDB adapter + email magic link/OTP | Xác thực nhẹ, không bắt người nhận đăng nhập |
| Background jobs | Trigger.dev Cloud ở MVP/beta | Resize, cleanup, email, scheduled reveal, webhook retry |
| Thanh toán | Payment abstraction; payOS là ứng viên MVP tại Việt Nam | VietQR/payment link; webhook là nguồn xác nhận |
| Email | Một transactional email provider + React Email | Magic link, receipt, thông báo gift/reaction |
| QR | Package tạo QR server-side, xuất SVG + PNG | QR chia sẻ và QR chất lượng in |
| Test | Vitest + Testing Library + Playwright | Unit, component, integration, E2E và visual regression |
| Observability | Sentry + structured logs; OpenTelemetry khi cần | Error, performance, tracing và alert |
| Product analytics | PostHog hoặc giải pháp tương đương, cấu hình tối thiểu dữ liệu | Funnel tạo–publish–mở–hoàn tất |
| Monorepo | pnpm workspaces + Turborepo | Web, worker, template SDK và template packages |
| Hosting | Vercel cho Next.js; R2/CDN cho asset; Atlas cho MongoDB | Managed-first, chưa cần Kubernetes/microservices |

Đây là một **modular monolith có worker**, không phải microservices:

1. Next.js phục vụ UI và các API đồng bộ ngắn.
2. MongoDB lưu dữ liệu nghiệp vụ có cấu trúc.
3. Object storage lưu mọi binary.
4. Job runner xử lý công việc nặng hoặc cần retry.
5. Template được build thành artifact có version, chạy trong sandbox của Viewer.

Hai quyết định quan trọng nhất:

- **MongoDB được chấp nhận có điều kiện**, không phải vì “schema linh hoạt” mà vì gift content là document thay đổi theo template. Các phần order/payment vẫn phải có invariant, unique index và transaction rõ ràng.
- **Template không phải React component nằm lẫn trong app chính.** Template là package có manifest, version, performance budget và artifact bất biến.

---

## 2. Đặc tính kỹ thuật riêng của LoveMemory

LoveMemory không giống một website CRUD thông thường. Stack phải xử lý đồng thời:

- Marketing/catalog cần SEO và tải nhanh.
- Studio là ứng dụng tương tác nhiều state, upload và preview liên tục.
- Viewer phải mở rất nhanh trên mobile, kể cả qua in-app browser và mạng yếu.
- Template có animation DOM/SVG/Canvas/WebGL với vòng đời độc lập.
- Dữ liệu mỗi template khác nhau nhưng phải validate được.
- Ảnh, nhạc và thumbnail chiếm phần lớn storage/bandwidth.
- Traffic có thể tăng đột biến lúc 0:00 hoặc các ngày lễ.
- Payment webhook, scheduled reveal và cleanup cần retry đáng tin cậy.
- Gift đã publish phải tiếp tục chạy đúng sau nhiều lần nâng cấp app.
- Ảnh và lời nhắn là dữ liệu riêng tư; không được cache/log tùy tiện.

Vì vậy, tiêu chí chọn stack theo thứ tự:

1. Tính đúng và an toàn dữ liệu.
2. Trải nghiệm Viewer trên mobile.
3. Tốc độ phát triển MVP.
4. Khả năng version hóa template.
5. Chi phí vận hành theo storage/bandwidth.
6. Khả năng quan sát và xử lý lỗi.
7. Khả năng mở rộng, nhưng không over-engineer.

---

## 3. Đánh giá lựa chọn frontend

### 3.1. ReactJS hay Next.js?

Không cần chọn “React hay Next.js” vì Next.js dùng React. Quyết định thật là:

- SPA React thuần với Vite; hoặc
- Next.js full-stack framework.

**Khuyến nghị: Next.js App Router.**

Lý do:

- Landing/catalog/template detail cần metadata, SEO, social preview và server rendering.
- Studio và dashboard vẫn dùng Client Components ở vùng cần tương tác.
- Viewer shell có thể render nhanh từ server/CDN rồi hydrate phần animation.
- Route Handlers đủ làm BFF cho MVP.
- Cùng codebase quản lý routing, auth, image metadata, sitemap và admin.

Không nên dùng Next.js như một framework ma thuật. Ranh giới rendering phải rõ:

| Khu vực | Cách render |
|---|---|
| Marketing, blog, catalog | Server Components + static/cached rendering |
| Template detail/demo metadata | Server Components; demo animation lazy-load |
| Studio editor | Client Component island; server chỉ cấp dữ liệu và mutation |
| Dashboard | Server Components cho read; client cho interaction |
| Gift Viewer shell | Server-rendered shell rất nhẹ |
| Template animation | Client-only, dynamic import hoặc sandboxed iframe |
| Admin | Server-first; mutation kiểm tra quyền tại DAL |

### 3.2. Phiên bản nên dùng

Tại thời điểm viết:

- Next.js 16 là dòng chính; bản 16.3 đã được phát hành.
- React 19.2 đi cùng hệ sinh thái Next.js 16.
- Node.js 24 đang ở trạng thái LTS; Node 20 đã EOL trong năm 2026.

Khuyến nghị:

- Pin **Node.js 24 LTS** trong file quản lý version và CI.
- Dùng **Next.js 16.x mới nhất đã có security patch**, không pin một minor cũ và cũng không để production tự động trôi theo latest.
- Dùng Renovate/Dependabot tạo PR nâng dependency; không tự merge major update.
- Mỗi đợt nâng Next.js phải chạy E2E Viewer, visual snapshots và CSP tests.

### 3.3. Server Components và Client Components

Quy tắc:

- Mặc định là Server Component.
- Chỉ thêm use client tại boundary nhỏ nhất cần browser API, animation, form state hoặc event handler.
- Không truyền object MongoDB/ObjectId trực tiếp sang client; chuyển thành DTO JSON rõ ràng.
- Không đưa secret, owner email, access policy hash hoặc internal asset key vào props client.
- Tránh một root client provider bao cả ứng dụng.

Riêng Studio có thể là một client subtree lớn vì đây thực sự là một editor. Điều đó không có nghĩa marketing và dashboard phải trở thành SPA.

### 3.4. Server Actions hay Route Handlers?

Dùng cả hai có chọn lọc:

**Server Actions phù hợp với:**

- cập nhật profile;
- thao tác admin đơn giản;
- form nội bộ gắn chặt với một route;
- mutation nhỏ không cần public contract.

**Route Handlers/API phù hợp với:**

- upload negotiation;
- autosave draft;
- publish;
- payment create/callback/webhook;
- gift payload;
- reaction/report;
- partner API;
- endpoint cần idempotency, retry hoặc test contract.

Mọi mutation đều phải:

- validate input tại server;
- authenticate và authorize gần data access;
- không tin ID/owner từ client;
- có idempotency cho publish/payment/job trigger;
- trả error code có cấu trúc.

Không dùng Proxy/Middleware như lớp phân quyền duy nhất. Quyền sở hữu phải được kiểm tra tại Data Access Layer/repository trước khi đọc hoặc ghi document.

---

## 4. UI, styling và design system

### 4.1. Tailwind CSS

**Khuyến nghị: Tailwind CSS 4**, với điều kiện browser support được xác nhận qua pilot.

Tailwind 4 dùng nhiều khả năng CSS hiện đại và tài liệu chính thức đặt baseline ở Safari 16.4+, Chrome 111+ và Firefox 128+. Với LoveMemory, rủi ro không nằm nhiều ở browser desktop mà ở Android WebView/in-app browser cũ.

Quyết định:

- Bắt đầu bằng Tailwind 4.
- Đặt browser support policy công khai.
- Test Zalo/Messenger/Facebook in-app browser trên thiết bị thật.
- Nếu pilot cho thấy tỷ lệ đáng kể nằm dưới baseline, lùi về Tailwind 3.4 hoặc tránh utility dựa vào CSS feature mới; không phỏng đoán.

### 4.2. Component system

Dùng:

- **shadcn/ui** để sở hữu source component.
- **Radix primitives** ở phần cần behavior/accessibility chuẩn.
- **CVA** hoặc pattern tương đương cho component variants.
- **CSS variables** cho token: color, radius, spacing, shadow, typography, motion duration.

Không dùng một bộ UI doanh nghiệp nặng cho Viewer. Admin có thể dùng component dày hơn; Viewer cần HTML/CSS tối thiểu.

Các token nên có ba tầng:

1. **Foundation:** neutral palette, typography, spacing, focus ring.
2. **Product semantic:** background, surface, text, danger, success.
3. **Template theme:** rose, midnight, cream… được scope trong iframe/root của template.

Template không được override global CSS của Studio/Viewer shell.

### 4.3. Form và validation

Dùng **React Hook Form + Zod**:

- React Hook Form quản lý input state và error UX.
- Zod là boundary validation dùng chung cho browser, API và worker.
- Template manifest sinh form theo field definition.
- Server luôn validate lại; validation client chỉ phục vụ UX.

Không để JSON Schema, TypeScript type và form rules trở thành ba nguồn sự thật độc lập. Nên có một canonical schema rồi sinh/derive phần còn lại ở build time.

### 4.4. State management

Đề xuất:

- React local state cho component nhỏ.
- React Hook Form cho form field.
- Zustand cho editor orchestration: current step, selected scene, crop state, unsaved changes, preview command.
- URL/search params cho filter catalog và state có thể chia sẻ.
- Server Components/fetch cho server state.
- TanStack Query chỉ thêm khi thực sự cần polling asset job, optimistic collaboration hoặc cache client phức tạp.

Không dùng Redux ở MVP. Không đưa toàn bộ gift draft vào một global store không version; autosave cần revision và migration rõ ràng.

---

## 5. Animation và template runtime

### 5.1. Không dùng một animation library cho mọi thứ

Chọn theo tầng:

| Nhu cầu | Công nghệ |
|---|---|
| Hover, opacity, transform đơn giản | CSS transition/keyframes |
| DOM/SVG sequence, gesture, enter/exit | Motion |
| Timeline rất đặc thù | Web Animations API hoặc timeline abstraction nhỏ |
| Firework, particle, star field | Canvas 2D |
| Cảnh 3D thật sự tạo giá trị | Three.js + React Three Fiber, dynamic import |
| Animation do designer xuất | Lottie chỉ cho template phù hợp và có budget |
| Audio dài/nhạc nền | HTMLAudioElement qua audio controller chung |
| Sound effect ngắn/phối âm | Web Audio API khi cần |

**Motion** là lựa chọn mặc định cho UI và DOM/SVG animation; package hiện dùng import từ motion/react. Nó hỗ trợ reduced-motion và gesture tốt. Không dùng Motion cho hàng nghìn particle.

Three.js/R3F không được nằm trong viewer shell. Mỗi template 3D phải:

- lazy-load sau thao tác mở quà;
- có fallback Canvas/DOM;
- giới hạn texture;
- xử lý lost WebGL context;
- pause khi tab ẩn;
- giảm chất lượng theo device capability.

### 5.2. Template là artifact versioned

Cấu trúc đề xuất:

~~~text
packages/
├── template-sdk/
│   ├── manifest-schema
│   ├── runtime-types
│   ├── test-harness
│   └── build-plugin
├── template-memory-box/
├── template-timeline/
└── template-midnight-wish/
~~~

Mỗi template có:

- manifest có schema/version/capability/performance budget;
- fixture data;
- thumbnail/demo asset;
- source;
- unit tests;
- Playwright visual tests;
- reduced-motion behavior;
- build output ESM có content hash.

Dùng **Vite library mode hoặc esbuild** để build template artifact riêng. Không phụ thuộc hoàn toàn vào bundle graph nội bộ của Next.js vì gift cũ phải tải đúng version artifact cũ.

### 5.3. Sandbox

Khuyến nghị dài hạn:

- Viewer shell ở app chính.
- Template frame phục vụ từ origin riêng, ví dụ templates.example.com.
- iframe sandbox chỉ có allow-scripts; không cho same-origin, form, top-navigation, camera/microphone.
- Giao tiếp qua postMessage với schema validate và kiểm tra event.source.
- CSP của template chỉ cho asset CDN và không cho arbitrary network.
- Runtime truyền payload đã sanitize, không truyền owner/session secret.

Giai đoạn prototype có thể render template nội bộ trực tiếp để đi nhanh, nhưng trước paid beta nên có sandbox vì template là bề mặt XSS lớn và sẽ được lưu lâu.

### 5.4. Contract tối thiểu

~~~ts
type TemplateRuntime = {
  mount(input: ValidatedGiftPayload, context: RuntimeContext): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek?(sceneId: string): void;
  destroy(): void;
};
~~~

RuntimeContext chỉ cấp capability được duyệt:

- resolve asset derivative;
- audio play/pause/mute;
- locale và timezone;
- reduced-motion;
- viewport/device class;
- scene event;
- abort signal.

Không cấp trực tiếp window parent, cookie, localStorage của app hoặc API credential.

### 5.5. Versioning rule

- Template version đã có gift publish thì artifact là immutable.
- Gift snapshot lưu templateVersionId và schemaVersion.
- Patch runtime phải backward compatible.
- Thay đổi dữ liệu cần migration rõ và test fixture cũ.
- CDN đặt Cache-Control immutable cho artifact có content hash.
- Có kill switch nếu một artifact gây crash/security issue.

---

## 6. Đánh giá MongoDB

### 6.1. MongoDB phù hợp ở đâu?

MongoDB phù hợp tự nhiên với:

- gift content khác nhau theo template;
- immutable content snapshot dạng document;
- template manifest/schema;
- draft thay đổi thường xuyên;
- metadata asset;
- read model của Viewer thường cần một gift + policy + asset references;
- iteration sản phẩm nhanh khi field còn thay đổi.

Ví dụ gift snapshot có thể giữ story data lồng nhau mà không cần hàng chục bảng field:

~~~json
{
  "_id": "ObjectId",
  "publicId": "random-128-bit-token",
  "ownerId": "ObjectId",
  "template": {
    "id": "memory-box",
    "version": "1.2.0",
    "schemaVersion": 3
  },
  "content": {
    "senderName": "Minh",
    "receiverName": "An",
    "scenes": [
      {
        "id": "first-trip",
        "caption": "Chuyến đi đầu tiên",
        "assetIds": ["ObjectId"]
      }
    ]
  },
  "access": {
    "mode": "unlisted",
    "unlockAt": null,
    "passwordHash": null
  },
  "status": "published",
  "revision": 4,
  "publishedAt": "ISODate",
  "updatedAt": "ISODate"
}
~~~

### 6.2. MongoDB khó ở đâu?

- Không có foreign key bảo vệ tham chiếu giữa gift, asset, owner và order.
- Báo cáo commerce/finance nhiều join sẽ kém tự nhiên hơn SQL.
- Schema linh hoạt dễ biến thành schema tùy tiện.
- Unbounded array làm document lớn và write contention.
- Transaction đa document có chi phí và cần hiểu retry semantics.
- TTL chỉ xóa document theo background process, không xóa asset R2 hoặc CDN cache.
- Event analytics lớn không nên ở chung operational cluster lâu dài.

### 6.3. Quyết định

**Dùng MongoDB Atlas cho MVP và giai đoạn đầu.**

Không cần đổi sang PostgreSQL ngay vì domain trọng tâm hiện tại là content snapshot. Nhưng cần đặt trigger đánh giá lại:

- marketplace creator/royalty trở thành core;
- invoice/refund/payout phức tạp;
- partner contract và reporting nhiều chiều;
- cần ledger tài chính chặt;
- query liên kết chiếm phần lớn công việc;
- team liên tục mô phỏng foreign key ở application layer.

Khi đó có hai lựa chọn:

1. Di chuyển commerce subsystem sang PostgreSQL.
2. Chuyển toàn hệ thống nếu MongoDB không còn tạo lợi thế.

Không chạy MongoDB + PostgreSQL ngay từ MVP chỉ để “phòng tương lai”.

### 6.4. Driver hay ODM?

Khuyến nghị mặc định: **official MongoDB Node.js driver + Zod + repository layer**.

Lý do:

- Truy cập atomic update, transaction, aggregation và index một cách trực tiếp.
- Ít magic/middleware khó đoán.
- Dễ dùng chung MongoClient với auth adapter.
- Document gift vốn đã được validate bằng schema template.

Mongoose vẫn hợp lý nếu đội ngũ rất quen và cần middleware/schema hook. Nếu dùng Mongoose:

- không lạm dụng populate;
- không để hook ẩn side effect quan trọng;
- kiểm soát model hot reload;
- vẫn validate API bằng Zod;
- vẫn dùng database validator/index migration.

Không thêm Prisma chỉ để có cảm giác “type-safe”. Type TypeScript không thay thế runtime validation và database invariant.

---

## 7. Thiết kế MongoDB cụ thể

### 7.1. Collections

~~~text
users
sessions / accounts / verifications
templates
templateVersions
gifts
giftRevisions
assets
orders
paymentAttempts
reactions
events
abuseReports
idempotencyKeys
jobOutbox
~~~

### 7.2. Embed hay reference?

**Embed trong gift:**

- current content snapshot;
- access policy nhỏ;
- template identity/version;
- publish/expiry state;
- denormalized cover derivative cần cho Viewer.

**Collection riêng:**

- revisions vì tăng theo thời gian;
- assets vì có pipeline/trạng thái/quyền sở hữu;
- reactions vì số lượng không cố định;
- events vì tăng rất nhanh;
- orders/paymentAttempts vì audit độc lập;
- reports vì workflow riêng.

Quy tắc: dữ liệu được đọc cùng nhau, có giới hạn nhỏ và cùng vòng đời thì embed. Dữ liệu tăng không giới hạn, có lifecycle/query riêng thì reference.

### 7.3. Index bắt buộc

Ví dụ logical indexes:

~~~js
gifts: { publicId: 1 } unique
gifts: { ownerId: 1, updatedAt: -1 }
gifts: { status: 1, unlockAt: 1 }
gifts: { status: 1, expiresAt: 1 }

templateVersions: { templateId: 1, version: 1 } unique
assets: { ownerId: 1, status: 1, createdAt: -1 }
assets: { storageKey: 1 } unique

orders: { orderCode: 1 } unique
orders: { ownerId: 1, createdAt: -1 }
paymentAttempts: { provider: 1, providerPaymentId: 1 } unique

idempotencyKeys: { scope: 1, key: 1 } unique
events: { giftId: 1, createdAt: -1 }
~~~

Index phải đi cùng query thật và được quản lý bằng migration script. Không tạo index cho mọi field: index làm tăng RAM/disk và chi phí write.

### 7.4. TTL index dùng đúng chỗ

TTL phù hợp cho:

- verification token;
- session hết hạn;
- idempotency record tạm;
- draft abandoned metadata;
- raw event có retention ngắn.

Không dùng TTL như workflow xóa gift hoàn chỉnh. MongoDB nói rõ TTL deletion chạy nền và không đảm bảo xóa đúng tức thời. Nó cũng không biết xóa object storage, thumbnail hay CDN cache.

Gift expiration phải là job nghiệp vụ:

1. đánh dấu expired;
2. ngừng Viewer access;
3. enqueue asset cleanup theo retention;
4. purge/revalidate cache;
5. ghi audit;
6. sau cùng mới hard-delete metadata.

### 7.5. Transactions và atomicity

MongoDB write trên một document là atomic. Vì vậy:

- Autosave current draft có thể dùng conditional update theo revision.
- Publish nên tạo immutable revision/snapshot và cập nhật gift trong transaction.
- Payment webhook cập nhật paymentAttempt, order và entitlement trong transaction.
- Mọi transaction cần retry với transient error.

Không gọi HTTP provider, upload R2 hoặc gửi email bên trong database transaction. Dùng outbox:

1. transaction ghi business state + jobOutbox;
2. worker đọc outbox;
3. thực hiện side effect idempotently;
4. đánh dấu hoàn tất.

### 7.6. Schema validation

Ba lớp:

1. Zod validate request và template payload.
2. Repository chỉ nhận domain object đã validate.
3. MongoDB JSON Schema validator bảo vệ invariant cơ bản như status enum, ownerId type, required timestamp.

Không đưa toàn bộ schema template thay đổi liên tục vào collection validator. Database validator giữ envelope/invariant; template content dùng template schema version.

### 7.7. Connection management

Trong serverless:

- Tạo một MongoClient singleton ngoài request handler và tái sử dụng pool.
- Không connect/close trên từng request.
- Giới hạn pool phù hợp số function instance.
- Đặt timeout rõ; không chờ vô hạn.
- App và Atlas ở cùng hoặc gần geographic region.
- Không mở Atlas 0.0.0.0/0 nếu có phương án network an toàn hơn.
- Dùng credential riêng cho web, worker và migration với least privilege.

---

## 8. Media storage và CDN

### 8.1. Không lưu ảnh/nhạc trong MongoDB

MongoDB có giới hạn 16 MiB cho BSON document và có GridFS, nhưng GridFS không phải lựa chọn tốt nhất cho workload này:

- Viewer cần CDN toàn cầu và cache dài.
- Browser upload nên đi thẳng object storage.
- Cần derivative ảnh theo kích thước/format.
- Storage và bandwidth sẽ lớn hơn metadata nhiều lần.
- Binary làm working set database phình to.

Dùng:

- **Cloudflare R2** nếu ưu tiên S3-compatible API và giảm egress cost.
- Hoặc AWS S3 + CloudFront nếu hạ tầng/đội ngũ đã ở AWS.

Không viết abstraction phức tạp cho mọi cloud. Chỉ tạo StoragePort nhỏ gồm createUpload, headObject, copy/promote, delete và signDownload.

### 8.2. Upload flow

~~~text
Browser
  → POST /api/uploads/init
  ← presigned PUT + assetId
Browser
  → PUT trực tiếp vào private object key
Browser
  → POST /api/uploads/complete
API
  → kiểm tra ownership/object metadata
  → enqueue media.process
Worker
  → sniff/decode/re-encode/strip EXIF
  → tạo derivatives
  → update asset = ready
Studio
  → poll/subscription nhận trạng thái ready
~~~

Presigned URL là bearer token:

- TTL ngắn;
- một object key ngẫu nhiên;
- chỉ đúng method;
- không log full URL;
- quota được kiểm tra trước;
- sau upload vẫn kiểm tra byte size/MIME/checksum.

R2 presigned URL hỗ trợ PUT nhưng không thay thế validation server-side.

### 8.3. Image pipeline

Dùng **Sharp/libvips trong background worker**:

- decode để loại file giả;
- auto-orient;
- xóa EXIF/GPS;
- giới hạn megapixel;
- tạo cover thumbnail;
- tạo 480/768/1280/1920 tùy slot;
- xuất AVIF/WebP và fallback cần thiết;
- blur placeholder;
- giữ original chỉ nếu gói/retention yêu cầu.

Object key ví dụ:

~~~text
private/{ownerId}/{assetId}/source
published/{giftPublicId}/{assetId}/w768.webp
published/{giftPublicId}/{assetId}/w1280.avif
templates/{templateId}/{version}/{contentHash}/index.js
~~~

Không đưa email/tên thật vào object key.

### 8.4. Audio

MVP nên dùng licensed library:

- audio master do hệ thống quản lý;
- tạo preview ngắn;
- encode định dạng tương thích;
- metadata/license lưu riêng;
- preload metadata hoặc đoạn đầu, không preload cả track.

Nếu cho upload voice note:

- giới hạn thời lượng/kích thước;
- transcode ở worker;
- strip metadata;
- có delete/report flow;
- không tự phát trước user gesture.

### 8.5. Cache policy

| Dữ liệu | Cache |
|---|---|
| Template artifact có content hash | public, max-age dài, immutable |
| Licensed static asset | public theo license |
| Published derivative có random key | cache dài; cần purge/delete strategy |
| Viewer shell | public cache/ISR |
| Gift payload unlisted | no-store hoặc TTL rất ngắn lúc MVP |
| Gift password/scheduled payload | private, no-store |
| Draft/original asset | private; signed access |
| Generic OG image | public cache |

Ưu tiên privacy và khả năng xóa hơn vài millisecond cache ở gift payload.

---

## 9. Backend và domain boundaries

### 9.1. Modular monolith

~~~text
src/
├── app/
│   ├── (marketing)/
│   ├── (studio)/
│   ├── (viewer)/
│   ├── dashboard/
│   ├── admin/
│   └── api/
├── modules/
│   ├── auth/
│   ├── templates/
│   ├── gifts/
│   ├── assets/
│   ├── publishing/
│   ├── billing/
│   ├── reactions/
│   ├── moderation/
│   └── analytics/
├── server/
│   ├── db/
│   ├── dal/
│   ├── repositories/
│   ├── storage/
│   ├── jobs/
│   └── observability/
└── shared/
    ├── schemas/
    ├── contracts/
    └── utils/
~~~

Quy tắc dependency:

- app gọi use case/module;
- module gọi repository/port;
- repository biết MongoDB;
- UI không import collection trực tiếp;
- template package không import module app;
- payment provider nằm sau BillingProvider interface.

### 9.2. API contract

Endpoint chính:

~~~text
POST   /api/uploads/init
POST   /api/uploads/complete
GET    /api/assets/{id}/status

POST   /api/gifts
PATCH  /api/gifts/{id}/draft
POST   /api/gifts/{id}/preview-token
POST   /api/gifts/{id}/publish
POST   /api/gifts/{id}/pause
DELETE /api/gifts/{id}

GET    /api/view/{publicId}/envelope
POST   /api/view/{publicId}/unlock
GET    /api/view/{publicId}/payload
POST   /api/view/{publicId}/events
POST   /api/view/{publicId}/reactions
POST   /api/view/{publicId}/report

POST   /api/billing/checkout
POST   /api/webhooks/payos
~~~

Envelope chỉ trả trạng thái an toàn: available/locked/scheduled/expired và generic cover. Payload cá nhân chỉ trả sau access check.

### 9.3. Error contract

Không trả message tự phát ở từng endpoint. Dùng:

~~~json
{
  "error": {
    "code": "GIFT_NOT_PUBLISHABLE",
    "message": "Món quà chưa thể xuất bản.",
    "fieldErrors": {
      "photos": "Cần ít nhất 3 ảnh."
    },
    "requestId": "..."
  }
}
~~~

Log requestId, không log content gift/password/token.

---

## 10. Authentication và authorization

### 10.1. Công cụ

Khuyến nghị **Better Auth** vì có integration Next.js, MongoDB adapter và magic-link plugin. Đây là lựa chọn cụ thể cho MVP, không phải ràng buộc vĩnh viễn.

Phương án khác:

- Auth.js nếu đội ngũ đã có kinh nghiệm sâu.
- Clerk/Auth0 nếu muốn giảm vận hành đổi lấy chi phí/vendor lock-in.
- Custom auth không nên là lựa chọn đầu.

### 10.2. User model

- Người tạo có tài khoản nhẹ qua email.
- Người nhận không cần tài khoản.
- Draft local có anonymousDraftId; claim vào account khi xác thực.
- Admin là role riêng, MFA bắt buộc.
- Partner dùng organization membership và scoped roles ở phase sau.

### 10.3. Magic link/OTP

- Token ngắn hạn, one-time, lưu dạng hash.
- Rate limit theo email + IP coarse-grained.
- Không tiết lộ email tồn tại hay chưa.
- Redirect URL chỉ thuộc allowlist.
- Cân nhắc email OTP như fallback vì mail scanner có thể truy cập link.
- Không dùng magic link quản trị làm public gift URL.

### 10.4. Authorization

Mỗi use case nhạy cảm kiểm tra:

1. session hợp lệ;
2. resource thuộc user/organization;
3. gift ở trạng thái cho phép thao tác;
4. entitlement/gói còn hiệu lực;
5. revision kỳ vọng còn đúng.

UI ẩn button không phải authorization.

---

## 11. Thanh toán

### 11.1. Lựa chọn MVP

Với người dùng Việt Nam, **payOS** là ứng viên thực dụng để thử paid beta vì có payment link/VietQR, Node.js SDK và webhook. Trước production vẫn cần xác nhận hợp đồng, phí, settlement, refund, hóa đơn và điều kiện kinh doanh tại thời điểm tích hợp.

Không gắn domain logic trực tiếp vào SDK:

~~~ts
interface BillingProvider {
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(rawBody: Uint8Array, headers: Headers): VerifiedPaymentEvent;
  getPayment(providerPaymentId: string): Promise<ProviderPayment>;
  cancel?(providerPaymentId: string): Promise<void>;
}
~~~

### 11.2. Source of truth

- returnUrl chỉ phục vụ UX.
- Webhook đã verify hoặc server reconciliation mới xác nhận paid.
- Không unlock premium chỉ dựa trên query param ở browser.
- Webhook handler phải idempotent.
- Lưu raw provider event đã redacted/hash để audit, không log secret.
- Amount/currency/order được đối chiếu với order nội bộ.
- Payment đến trước/đến lặp/đến trễ đều phải xử lý đúng.

### 11.3. Order model

Order lưu snapshot của:

- product/plan;
- price/currency;
- retention/entitlement;
- giftId/ownerId;
- provider;
- status state machine;
- timestamps;
- refund state.

Không đọc giá hiện tại từ catalog để diễn giải order lịch sử.

---

## 12. Background jobs và scheduling

### 12.1. Những việc không chạy trong request

- resize/transcode media;
- thumbnail/OG render;
- email;
- scheduled reveal notification;
- expire/delete cleanup;
- payment reconciliation;
- webhook retry;
- analytics rollup;
- template canary/health check;
- export ZIP/video.

### 12.2. Công cụ

**MVP/beta:** Trigger.dev Cloud phù hợp vì có queue, retry, scheduling và observability, tránh phải vận hành Redis worker ngay.

**Nếu muốn self-host lâu dài:** BullMQ + Redis + worker container là lựa chọn kiểm soát tốt hơn, nhưng có chi phí vận hành, deploy và monitoring.

Không dùng setTimeout, cron nằm trong web process hoặc fire-and-forget Promise sau response.

### 12.3. Job contract

Mỗi job có:

- stable job type;
- schema version;
- idempotency key;
- retry/backoff;
- timeout;
- dead-letter/manual retry path;
- correlation/request ID;
- input chỉ chứa ID, không nhét full sensitive payload;
- side effect có check “đã làm chưa”.

Ví dụ media.process có idempotency theo assetId + pipelineVersion.

---

## 13. QR, share và social preview

### 13.1. QR generation

Tạo QR server-side:

- PNG cho chia sẻ;
- SVG cho in;
- error correction cấu hình theo mức trang trí;
- quiet zone đúng;
- URL HTTPS ngắn;
- không đưa PII vào QR;
- test trên iOS/Android và bản in thật.

Lưu metadata QR, không bắt buộc lưu mọi file QR nếu có thể tái tạo deterministic.

### 13.2. Share

- Dùng Web Share API khi browser hỗ trợ và có user gesture.
- Luôn có fallback copy link/download QR.
- Không coi Web Share API là universal.
- Theo dõi share button click, không cố đọc người dùng đã gửi cho ai.

### 13.3. Open Graph

- Mặc định generic preview.
- User opt-in mới render ảnh/tên cá nhân.
- Bot preview chỉ nhận envelope; không làm tăng humanOpenedAt.
- One-time unlock phải dựa trên tương tác/challenge, không dựa request đầu tiên.

---

## 14. Cache, rate limit và realtime

### 14.1. Cache

Không thêm Redis chỉ để “có cache”. Dùng trước:

- Next.js explicit cache cho catalog/template metadata;
- CDN cho static/template/media;
- MongoDB index đúng cho dữ liệu nghiệp vụ.

Thêm Redis/KV khi cần:

- distributed rate limit;
- short-lived unlock challenge;
- idempotency nóng;
- lock/concurrency;
- queue tự vận hành;
- hot read có số liệu chứng minh.

Không dùng in-memory Map cho rate limit trên serverless.

### 14.2. Realtime

MVP chưa cần WebSocket.

- Studio poll asset status với backoff hoặc job-provider realtime hook.
- Viewer chạy local sau khi nhận payload.
- Reaction notification qua email.

Chỉ thêm realtime collaboration khi có use case “hai người cùng sửa” đã được xác thực.

### 14.3. Rate-limit scopes

- auth/magic link;
- unlock/password attempt;
- upload init/complete;
- gift create/publish;
- reaction/report;
- payment checkout;
- public event ingestion.

Password gift cần rate limit mạnh hơn view unlisted; report cần chống spam nhưng không được chặn nạn nhân dễ dàng.

---

## 15. Bảo mật ứng dụng

### 15.1. Baseline

- CSP có nonce/hash; template origin và asset origin allowlist rõ.
- HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Cookie HttpOnly, Secure, SameSite phù hợp.
- CSRF protection cho cookie-authenticated mutation.
- Zod validate mọi boundary.
- Sanitize rich text bằng allowlist; không render raw HTML.
- SVG upload bị chặn hoặc rasterize; không phục vụ SVG người dùng như active content.
- Presigned URL ngắn hạn; object key random.
- Password gift băm bằng Argon2id hoặc library uy tín.
- Secret không bắt đầu bằng NEXT_PUBLIC.
- Admin MFA, audit log và least privilege.
- Webhook verify trên raw/đúng representation theo provider docs.
- Dependency/security update định kỳ, đặc biệt Next.js.

### 15.2. Content Security Policy và template

CSP app chính không nên nới lỏng chỉ để một template hoạt động. Template chạy ở origin/boundary riêng với policy riêng.

Tránh:

- unsafe-eval;
- arbitrary remote scripts;
- inline event handlers;
- third-party tracking trong template;
- iframe allow-same-origin + allow-scripts cùng lúc nếu không có lý do đã review.

### 15.3. Data minimization

- Không log gift text, password, magic token, signed URL hoặc full payment payload.
- Strip EXIF/GPS.
- Analytics dùng gift ID pseudonymous, không dùng tên người nhận.
- Tách operational log và product analytics.
- Retention và deletion job được test.
- Backup có retention và quy trình xóa/khôi phục được mô tả.

---

## 16. Testing strategy

LoveMemory phụ thuộc mạnh vào browser và hình ảnh; unit test một mình không đủ.

### 16.1. Test pyramid

| Lớp | Công cụ | Nội dung |
|---|---|---|
| Unit | Vitest | schema, domain state machine, access policy, pricing, idempotency |
| Component | Testing Library + Vitest | form fields, editor step, error/a11y behavior |
| Repository integration | Vitest + MongoDB test environment | index, atomic update, transaction, optimistic concurrency |
| API integration | Vitest hoặc request harness | authz, validation, webhook, publish flow |
| E2E | Playwright | create → upload → preview → pay stub → publish → open |
| Visual | Playwright screenshot | template scenes theo viewport/reduced-motion |
| Performance | Lighthouse CI + custom budget | Viewer LCP/JS/media budget |
| Security | automated headers/CSP + dependency scan | XSS, access control, upload abuse |

### 16.2. Template contract tests

Mọi template chạy cùng một suite:

- manifest/schema valid;
- fixture default và max-length;
- missing optional field;
- tiếng Việt/emoji;
- portrait/landscape image;
- reduced motion;
- pause/resume/destroy;
- tab hidden;
- WebGL unavailable nếu có 3D;
- no unexpected network call;
- no console error;
- performance budget;
- screenshot tại các scene chính.

Visual snapshot phải chạy trên image CI cố định vì rendering khác nhau theo OS/font/GPU.

### 16.3. Critical E2E

1. Anonymous bắt đầu draft.
2. Upload ảnh direct-to-storage.
3. Asset processing hoàn tất.
4. Claim draft sau auth.
5. Preview cùng renderer.
6. Publish free/paid.
7. Mở QR URL trong anonymous context.
8. Password/schedule behavior.
9. Pause/delete làm Viewer mất quyền.
10. Payment webhook lặp không cấp entitlement hai lần.

---

## 17. Observability và analytics

### 17.1. Technical observability

Dùng:

- Sentry cho client/server error và performance sample.
- Structured JSON logs có requestId, giftPublicId hash, template version, route, latency, error code.
- Provider dashboards cho Atlas, R2, Vercel và jobs.
- Uptime/synthetic monitor mở canary gift.
- OpenTelemetry khi cần trace qua web → Mongo → job → storage.

Alert quan trọng:

- Viewer fatal error tăng theo template version;
- p95 gift payload latency;
- publish failure;
- asset processing failure/queue lag;
- payment webhook failure;
- email/magic link delivery failure;
- 404/403 bất thường;
- Mongo connection saturation;
- storage/CDN error;
- deletion job quá SLA.

### 17.2. Product analytics

Event taxonomy:

~~~text
template_demo_started
customization_started
required_content_completed
preview_started
publish_clicked
checkout_started
payment_succeeded
gift_open_interaction
scene_completed
gift_completed
reaction_sent
gift_replayed
~~~

Không gửi:

- tên;
- lời nhắn;
- asset URL;
- email;
- password;
- vị trí chính xác.

Bot/social crawler phải tách khỏi human session.

---

## 18. Monorepo và developer experience

### 18.1. Cấu trúc đề xuất

~~~text
love-memory/
├── apps/
│   ├── web/
│   └── worker/              # nếu dùng worker tự host; có thể chưa cần ở MVP
├── packages/
│   ├── ui/
│   ├── config-eslint/
│   ├── config-typescript/
│   ├── contracts/
│   ├── database/
│   ├── domain/
│   ├── template-sdk/
│   ├── template-memory-box/
│   ├── template-timeline/
│   └── template-midnight-wish/
├── tooling/
│   ├── template-build/
│   ├── migrations/
│   └── seed/
├── tests/
│   └── e2e/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
~~~

Nếu chỉ có một lập trình viên và ba template đầu, vẫn dùng workspace nhưng không tách thành quá nhiều package nhỏ. Package chỉ được tạo khi có boundary thực.

### 18.2. Tooling

- pnpm với lockfile commit.
- TypeScript strict, noUncheckedIndexedAccess.
- ESLint CLI với rule React/Next/security phù hợp.
- Prettier; format tự động, không tranh luận style trong PR.
- Husky/lint-staged là tùy chọn; CI mới là source of truth.
- Commit/PR nhỏ, changelog template version.
- Environment schema validate khi app start/build.
- Seed data cho ba demo gift.
- ADR cho quyết định khó đảo ngược.

### 18.3. Dependency policy

Trước khi thêm package:

1. Browser/platform có làm được đủ tốt không?
2. Bundle tăng bao nhiêu?
3. Package có ESM/tree-shaking/TypeScript không?
4. Có active maintenance và security policy không?
5. Nó đi vào Viewer shell hay chỉ lazy-load?
6. Có license phù hợp thương mại không?
7. Có thể khóa trong template package thay vì app toàn cục không?

Đặc biệt không để một template kéo Three.js, Lottie hoặc GSAP vào mọi Viewer.

---

## 19. Deployment và môi trường

### 19.1. Môi trường

- **local:** Mongo local/container hoặc Atlas dev; storage emulator/provider dev.
- **preview:** mỗi PR; database/namespace và storage prefix cách ly.
- **staging:** giống production, payment sandbox/test channel.
- **production:** secret, cluster, bucket và auth credentials riêng.

Không dùng production data trong preview. Demo fixture phải là dữ liệu giả.

### 19.2. Hosting recommendation

MVP:

- Next.js trên Vercel.
- MongoDB Atlas managed.
- R2 + custom asset domain/CDN.
- Trigger.dev Cloud.
- Transactional email provider.

Đặt Next.js compute và Atlas gần nhau về network region. Viewer asset đi qua CDN nên không phụ thuộc vị trí compute sau lần tải shell.

Không dùng Edge Runtime cho route cần official MongoDB Node driver, Sharp hoặc Node-specific crypto. Node runtime là mặc định cho BFF; edge/CDN dùng cho static delivery và request routing phù hợp.

### 19.3. CI pipeline

~~~text
install --frozen-lockfile
→ lint
→ typecheck
→ unit/component test
→ template manifest/contract test
→ build all packages
→ Playwright critical path
→ visual/performance budget
→ dependency/license/security check
→ deploy preview
→ manual/automatic production gate
~~~

Database/index migration chạy như một release step kiểm soát được, không âm thầm tạo index trong mọi app startup.

### 19.4. Release và rollback

- App deploy có rollback.
- Template artifact immutable; publish registry pointer sau khi test.
- Database change ưu tiên expand/contract backward compatible.
- Job payload có schema version.
- Security kill switch có thể tắt một template/version.
- Feature flag cho payment, reaction, scheduled reveal và template mới.

---

## 20. Chi phí và chiến lược mở rộng

### 20.1. Những thứ chiếm chi phí thật

Theo thứ tự có khả năng:

1. Media storage và CDN bandwidth.
2. Image/audio/video processing.
3. Database khi events/index/working set tăng.
4. Background job execution.
5. Email/OTP.
6. Observability retention.
7. Support và template QA.

HTML/JSON gift nhỏ; ảnh, audio và support dài hạn mới là bài toán kinh tế.

### 20.2. Giai đoạn MVP

- Một Atlas cluster phù hợp pilot, bật backup khi có dữ liệu trả phí.
- R2/S3 lifecycle rule cho abandoned uploads/originals.
- Trigger.dev managed.
- Viewer CDN-first.
- Events lấy mẫu/tối thiểu.
- Không Redis nếu chưa cần.

### 20.3. Khi tăng trưởng

Scale theo tín hiệu:

- Mongo: index/query optimization → vertical scale → read strategy/sharding chỉ khi cần.
- Media: derivative policy, cache hit, lifecycle/archival.
- Worker: concurrency theo job type, tách media queue.
- Analytics: đẩy event sang PostHog/ClickHouse/warehouse, không giữ vô hạn trong Mongo operational.
- API: tách partner/public API khi contract ổn định.
- Commerce: cân nhắc PostgreSQL khi ledger/reporting trở thành core.

Không chuyển microservices/Kubernetes chỉ vì số người dùng tăng. CDN, object storage và queue đã hấp thụ phần tải khó nhất.

---

## 21. Những lựa chọn không khuyến nghị lúc đầu

| Lựa chọn | Vì sao chưa phù hợp |
|---|---|
| React SPA thuần cho toàn bộ app | Mất lợi thế SEO/server rendering và phải tự ghép nhiều hạ tầng |
| NestJS/Express service riêng ngay | Trùng lớp với Next BFF khi domain/team còn nhỏ |
| Microservices | Tăng network, deployment, tracing và consistency cost |
| Kubernetes | Không giải quyết rủi ro sản phẩm hiện tại |
| Redux | Editor chưa cần mức ceremony này |
| MongoDB GridFS cho media | Không tối ưu cho direct upload/CDN/derivative |
| Lưu base64 ảnh trong gift document | Tăng document, RAM, bandwidth và chạm giới hạn BSON |
| Public template marketplace | Bề mặt bảo mật/license/moderation quá lớn |
| WebGL cho mọi template | Bundle nặng, pin/GPU nóng, lỗi in-app browser |
| Upload nhạc thương mại tùy ý | Rủi ro bản quyền và storage |
| Redis từ ngày đầu | Chưa có use case bắt buộc ngoài thứ provider managed đã xử lý |
| WebSocket/realtime collaboration | Chưa có nhu cầu đã xác thực |
| Tự xây auth | Rủi ro bảo mật không tạo khác biệt sản phẩm |
| Tin returnUrl thanh toán | Có thể giả mạo/trạng thái chưa chắc chắn; phải dùng verified webhook/reconciliation |

---

## 22. Stack theo từng giai đoạn

### Prototype xác thực

- Next.js + TypeScript + Tailwind.
- Template hardcoded nhưng dùng manifest/schema ngay.
- Local/mock data hoặc Atlas dev.
- R2 dev bucket.
- Chưa cần payment thật; dùng entitlement test.
- Playwright cho một luồng.

### MVP pilot

- MongoDB Atlas.
- Better Auth + email.
- Direct upload + Sharp worker.
- Ba template artifact versioned.
- QR PNG/SVG.
- Trigger.dev.
- Sentry.
- Basic analytics.

### Paid beta

- payOS qua BillingProvider.
- Webhook/idempotency/outbox.
- Backup/restore drill.
- Password/scheduled access.
- Report/takedown.
- Visual/performance matrix.
- Partner thử nghiệm.

### Growth

- Redis/KV nếu rate-limit/cache/lock cần.
- Dedicated worker hoặc self-host queue nếu economics hợp lý.
- Warehouse/event platform.
- Partner API.
- Template SDK/creator workflow.
- PostgreSQL cho commerce nếu trigger ở mục 6.3 xảy ra.

---

## 23. Thứ tự triển khai đề xuất

### Sprint 0 — Foundation

- Khởi tạo pnpm workspace/Turborepo.
- Next.js 16 + React 19 + TypeScript strict + Tailwind 4.
- CI lint/typecheck/test/build.
- Environment validation và secret policy.
- Design tokens và component primitives.
- ADR cho MongoDB, object storage, template isolation.

### Sprint 1 — Domain và database

- MongoClient singleton/repository/DAL.
- Collections, validators và index migrations.
- Gift state machine, revision và optimistic concurrency.
- Better Auth + email magic link/OTP.
- Seed template/demo.

### Sprint 2 — Media

- R2 direct upload.
- Asset status machine.
- Background image pipeline.
- Crop/preview/derivative resolver.
- Quota, orphan cleanup và delete.

### Sprint 3 — Template platform

- Template SDK/manifest validator.
- Build artifact/content hash.
- Viewer runtime + postMessage contract.
- Memory Box template đầu tiên.
- Reduced-motion/performance/visual tests.

### Sprint 4 — Studio và publish

- Schema-driven form.
- Zustand orchestration + autosave revision.
- Preview cùng renderer.
- Atomic publish + gift payload access.
- QR/share/OG generic.

### Sprint 5 — Monetization và hardening

- BillingProvider + payOS.
- Verified webhook/idempotency/outbox.
- Scheduled/password access.
- Sentry/alerts/analytics.
- Report/takedown.
- Safari iOS/Chrome Android/in-app browser test.

---

## 24. Các ADR nên tạo

ADR là bản ghi ngắn: bối cảnh, lựa chọn, alternatives, hậu quả và trigger xem lại.

1. ADR-001: Next.js App Router làm web + BFF.
2. ADR-002: MongoDB Atlas là operational database.
3. ADR-003: Official MongoDB driver thay vì ODM mặc định.
4. ADR-004: Binary ở R2/S3, không ở MongoDB/GridFS.
5. ADR-005: Template artifact immutable và sandbox boundary.
6. ADR-006: Route Handler cho durable/public mutations; Server Action có giới hạn.
7. ADR-007: Trigger.dev cho background jobs giai đoạn đầu.
8. ADR-008: Better Auth + passwordless creator auth.
9. ADR-009: Payment provider abstraction, webhook là source of truth.
10. ADR-010: Privacy-sensitive payload no-store, generic OG mặc định.

---

## 25. Checklist trước khi bắt đầu code tính năng

- [ ] Xác định browser support, đặc biệt in-app browser.
- [ ] Chốt Node/Next/Tailwind version và lockfile.
- [ ] Chốt Atlas + compute region gần nhau.
- [ ] Tạo dev/staging/prod isolation.
- [ ] Có Mongo index migration và schema validator.
- [ ] Có R2/S3 direct-upload prototype.
- [ ] Có template manifest/schema v1.
- [ ] Có một template build thành artifact riêng.
- [ ] Có Viewer shell + reduced-motion.
- [ ] Có auth library, DAL và owner authorization.
- [ ] Có retention/deletion flow.
- [ ] Có payment state machine trước khi tích hợp provider.
- [ ] Có event taxonomy không chứa PII.
- [ ] Có E2E “create → publish → open”.
- [ ] Có security headers/CSP baseline.
- [ ] Có error tracking và request ID.
- [ ] Có backup/restore plan trước paid beta.

---

## 26. Đề xuất cuối cùng

Giữ định hướng của bạn, nhưng chuẩn hóa thành:

> **Next.js modular monolith + MongoDB Atlas cho metadata/document + R2/S3 cho media + background job runner + template runtime versioned và sandboxed.**

Stack này tối ưu đúng ba bài toán của LoveMemory:

- phát triển sản phẩm nhanh với TypeScript/React;
- biểu diễn gift content linh hoạt bằng MongoDB;
- phục vụ trải nghiệm media/animation nhanh và ổn định qua CDN.

Không nên tối ưu sớm bằng microservices hay nhiều database. Nên đầu tư sớm vào những thứ khó sửa về sau: template versioning, asset lifecycle, access control, idempotent payment và khả năng xóa dữ liệu.

### Stack chốt cho MVP

~~~text
Node.js 24 LTS
pnpm + Turborepo
Next.js 16 App Router + React 19 + TypeScript strict
Tailwind CSS 4 + shadcn/ui/Radix
React Hook Form + Zod + Zustand
CSS/WAAPI + Motion + Canvas 2D
MongoDB Atlas + official mongodb driver
Cloudflare R2 + CDN + Sharp
Better Auth + MongoDB adapter + passwordless email
Trigger.dev
payOS behind BillingProvider
Vitest + Testing Library + Playwright
Sentry + structured logs + minimal product analytics
Vercel + managed providers
~~~

---

## 27. Nguồn tham khảo chính thức

### Runtime và frontend

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Next.js documentation](https://nextjs.org/docs)
- [Next.js 16 release](https://nextjs.org/blog/next-16)
- [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [Next.js Server Functions security notes](https://nextjs.org/docs/app/api-reference/directives/use-server)
- [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [Tailwind CSS v4 browser compatibility](https://tailwindcss.com/docs/compatibility)
- [Motion for React](https://motion.dev/docs/react)
- [Motion reduced-motion support](https://motion.dev/docs/react-use-reduced-motion)

### MongoDB

- [Official MongoDB Node.js driver](https://www.mongodb.com/docs/drivers/node/current/)
- [MongoDB indexes](https://www.mongodb.com/docs/drivers/node/current/indexes/)
- [MongoDB transactions](https://www.mongodb.com/docs/drivers/node/current/fundamentals/transactions/)
- [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)
- [MongoDB BSON document size](https://www.mongodb.com/docs/v8.0/core/document/)
- [MongoDB serverless connection guidance](https://www.mongodb.com/docs/atlas/manage-connections-aws-lambda/)

### Storage, auth, jobs, payment và test

- [Cloudflare R2 architecture](https://developers.cloudflare.com/r2/how-r2-works/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Better Auth MongoDB adapter](https://better-auth.com/docs/adapters/mongo)
- [Better Auth magic link](https://better-auth.com/docs/plugins/magic-link)
- [Trigger.dev documentation](https://trigger.dev/docs/introduction)
- [Trigger.dev retry behavior](https://trigger.dev/docs/errors-retrying)
- [payOS integration flow](https://payos.vn/docs/)
- [payOS Node.js SDK and webhook verification](https://payos.vn/docs/sdks/back-end/node/)
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
