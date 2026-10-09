import { Container } from "@love-memory/ui";
import type { Metadata } from "next";

export const metadata: Metadata = {
  description: "LoveMemory lưu gì, ai xem được, giữ bao lâu và cách xoá hoặc tải dữ liệu của bạn.",
  title: "Chính sách quyền riêng tư",
};

/** What the system keeps and for how long (`privacy-notice`); each row matches real behavior. */
export const RETENTION_ROWS: readonly (readonly [string, string])[] = [
  ["Bản nháp (chữ, ngày, nhạc đã chọn, ảnh)", "Đến khi bạn xoá."],
  [
    "Món quà đã gửi",
    "Người nhận mở được trong thời hạn của gói (14 ngày với gói Miễn phí, 1 năm với gói Tiêu chuẩn). Sau đó món quà vẫn được giữ để bạn xem lại hoặc xoá, đến khi bạn xoá.",
  ],
  ["Bản đã gửi trước khi bạn cập nhật", "Xoá trong vài phút sau khi cập nhật."],
  ["Ảnh gốc", "Không giữ. Chỉ giữ ảnh đã xử lý, đã xoá thông tin vị trí và thiết bị."],
  [
    "Món quà bạn xoá",
    "Đường dẫn ngừng hoạt động ngay; chữ và ảnh bị xoá hẳn trong vòng 24 giờ. Bản sao lưu cơ sở dữ liệu còn chứa món quà được xoá trong vòng 7 ngày. Chỉ giữ mã và thời điểm trong 1 năm.",
  ],
  ["Báo cáo vi phạm và nhật ký quản trị", "1 năm."],
  ["Phiên đăng nhập", "30 ngày."],
  ["Thống kê ẩn danh (khi được bật)", "180 ngày, không gắn với tài khoản."],
];

export default function PrivacyPage() {
  return (
    <main>
      <Container className="max-w-3xl py-12 sm:py-16">
        <article className="space-y-8 leading-7 text-stone-700">
          <header>
            <h1 className="text-4xl font-black tracking-tight text-stone-900">
              Chính sách quyền riêng tư
            </h1>
            <p className="mt-3">
              LoveMemory giúp bạn tạo một món quà riêng tư. Trang này nói rõ chúng tôi lưu gì, ai
              xem được, giữ trong bao lâu và cách bạn xoá hoặc tải dữ liệu của mình.
            </p>
          </header>

          <section>
            <h2 className="text-xl font-black text-stone-900">Chúng tôi lưu gì</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Email của bạn, để đăng nhập bằng liên kết dùng một lần.</li>
              <li>
                Bản nháp và món quà đã gửi: chữ, ngày kỷ niệm, bản nhạc đã chọn và ảnh bạn tải lên.
              </li>
              <li>Báo cáo vi phạm do người nhận gửi.</li>
              <li>Nhật ký vận hành không chứa nội dung món quà.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-black text-stone-900">Ai xem được món quà</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Bạn, khi đăng nhập hoặc trên trình duyệt đã tạo bản nháp.</li>
              <li>Người có đường dẫn, trong lúc món quà đang được chia sẻ.</li>
              <li>
                Đội vận hành, chỉ khi xem xét một báo cáo vi phạm, và mỗi lần xem đều được ghi lại.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-black text-stone-900">Lưu trữ trong bao lâu</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="text-stone-500">
                  <th className="py-2 pr-4">Dữ liệu</th>
                  <th className="py-2">Thời gian lưu</th>
                </tr>
              </thead>
              <tbody>
                {RETENTION_ROWS.map(([data, period]) => (
                  <tr className="border-t border-stone-200 align-top" key={data}>
                    <td className="py-2 pr-4 font-semibold text-stone-900">{data}</td>
                    <td className="py-2">{period}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="text-xl font-black text-stone-900">Cookie và bộ nhớ trình duyệt</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Cookie phiên đăng nhập, để giữ bạn đăng nhập.</li>
              <li>
                Cookie bản nháp ẩn danh (30 ngày), để chỉ trình duyệt của bạn sửa được bản nháp chưa
                đăng nhập.
              </li>
              <li>Không có cookie quảng cáo hay công cụ theo dõi của bên thứ ba.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-black text-stone-900">Quyền của bạn</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Tạm dừng chia sẻ hoặc xoá món quà bất cứ lúc nào trong trang chỉnh sửa.</li>
              <li>Tải dữ liệu món quà dưới dạng tệp JSON trong trang chỉnh sửa.</li>
              <li>
                Báo cáo một món quà vi phạm bằng liên kết “Báo cáo nội dung” bên dưới món quà.
              </li>
            </ul>
          </section>
        </article>
      </Container>
    </main>
  );
}
