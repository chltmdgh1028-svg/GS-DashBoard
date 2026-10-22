/**
 * The master datasets the console exposes.
 *
 * These are the inspection app's `adminGrid.DATASETS` keys - the tabs the
 * Google Sheet used to hold. The app does not publish the list over HTTP, so
 * it is mirrored here; a name that is not in the app's own map is answered
 * GRID_DATASET_INVALID, which surfaces as a 404 rather than as bad data.
 *
 * Labels are the app's own, so a row discussed in one UI is the same row in
 * the other.
 */
import type { DatasetEntry } from "../src/domain/types.js";

export const DATASETS: DatasetEntry[] = [
  { name: "work_schedule", label: "근무표" },
  { name: "reservation_rows", label: "사전예약" },
  { name: "product_master", label: "상품 기준정보" },
  { name: "partner_category_master", label: "파트너 기준정보" },
  { name: "event_rows", label: "행사표" },
  { name: "mapping_rows", label: "협력사 별칭 매핑" },
  { name: "exclude_rows", label: "제외목록" },
  { name: "inspection_criteria", label: "검품 기준" },
];

export function isKnownDataset(name: string) {
  return DATASETS.some((entry) => entry.name === name);
}
