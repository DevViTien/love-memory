import { type ReportCategory } from "../application/abuse-reports";

/**
 * The Vietnamese names of the report categories (`abuse-reports`). A plain module, so server pages
 * (the admin queue) and the client form share the values; a `"use client"` export would reach a
 * server component only as a client reference.
 */
export const REPORT_CATEGORY_LABELS: Readonly<Record<ReportCategory, string>> = {
  child_safety: "Xâm hại trẻ em",
  harassment: "Quấy rối hoặc lăng mạ",
  illegal: "Hoạt động phạm pháp",
  other: "Lý do khác",
  self_harm: "Tự gây hại hoặc đe doạ tính mạng",
  sexual: "Nội dung tình dục không mong muốn",
  spam: "Lừa đảo hoặc spam",
  violence: "Bạo lực hoặc đe doạ",
};
