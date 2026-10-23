/**
 * Photo ids on an inspection row.
 *
 * Verified against production `getInspectionRows` (2026-10-23, 1,890 rows,
 * 333 with photos). The row carries the same ids three ways:
 *
 *   photoFileIds      array of `r2_<uuid>_<hash>` strings
 *   사진파일ID목록     the same ids, newline separated
 *   사진링크목록       relative `/api/photo?id=...&sz=...` URLs, newline separated
 *
 * The array is preferred because it needs no parsing; the newline string is
 * the fallback for a row that only has the legacy field. Both are read
 * defensively - a row with neither simply has no photos.
 */
export interface PhotoBearingRow {
  photoFileIds?: unknown;
  사진파일ID목록?: unknown;
  [key: string]: unknown;
}

const ID_PATTERN = /^[A-Za-z0-9_.-]{10,120}$/;

export function photoIdsOf(row: PhotoBearingRow): string[] {
  const fromArray = Array.isArray(row.photoFileIds) ? row.photoFileIds : [];
  const raw =
    fromArray.length > 0
      ? fromArray.map((item) => String(item ?? "").trim())
      : String(row.사진파일ID목록 ?? "")
          .split(/[\n,;|]/)
          .map((item) => item.trim());

  // The same pattern the inspection app's /api/photo enforces, so an id that
  // would be rejected there never becomes a broken image here. Duplicates
  // collapse: one photo must not render twice.
  return [...new Set(raw.filter((id) => ID_PATTERN.test(id)))];
}
