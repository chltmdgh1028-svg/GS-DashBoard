import type { FileRole } from "./types.js";

export const fileRoleLabels: Record<FileRole, string> = {
  storeMaster: "신선강화 점포 Master",
  organizationMaster: "조직 Master",
  operatingDays: "1. 영업일수",
  currentDaily: "2. 일자별매출/매입원가",
  previousDaily: "3. 직전전단매출",
  categoryMetrics: "4. 대분류매출/매출이익",
  wasteCost: "5. 폐기원가",
  productMetrics: "6. 점별 상품실적",
  focusProducts: "7. 중점취급상품",
  freshSales: "8. 신선매출",
  target: "전단행사 목표",
  reference: "기존 작업용 Reference",
  unknown: "미분류",
};

export const requiredCampaignFileRoles: FileRole[] = [
  "storeMaster",
  "organizationMaster",
  "operatingDays",
  "currentDaily",
  "previousDaily",
  "categoryMetrics",
  "wasteCost",
  "productMetrics",
  "focusProducts",
  "freshSales",
];

export const optionalCampaignFileRoles: FileRole[] = ["target"];
