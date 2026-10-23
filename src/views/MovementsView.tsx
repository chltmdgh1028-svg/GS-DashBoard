import { useMemo, useState } from "react";
import type { MovementRecord } from "../domain/types";
import type { FilterMode } from "../api";
import { fetchMovements } from "../api";
import { useResource } from "../useResource";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaItem,
  PageHeader,
  SearchInput,
  Segmented,
  SectionCard,
} from "../ui";
import { IconMovement } from "../ui/icons";
import { formatNumber } from "../view-models/format";

const text = (value: unknown) => (value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * `current` returned 0 records on production on a day with no movements yet
 * while `all` returned 61, so `all` is the default: an empty first screen
 * would read as "nothing has ever been returned".
 */
const MODE_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "current", label: "오늘 작업" },
];

/** 처리유형 is 회송 or 교환; colour them differently so a list of both stays readable. */
function kindTone(kind: string) {
  if (kind.includes("회송")) return "danger" as const;
  if (kind.includes("교환")) return "info" as const;
  return "neutral" as const;
}

/** 회송 and 교환 each carry their own quantity column; show the one that applies. */
function quantityOf(record: MovementRecord) {
  const kind = text(record.처리유형);
  if (kind.includes("교환")) return number(record.교환수량);
  if (kind.includes("회송")) return number(record.회송수량);
  return number(record.회송수량) || number(record.교환수량);
}

export function MovementsView() {
  const [mode, setMode] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");

  const { data, error, loading, reload } = useResource(() => fetchMovements({ filterMode: mode }), `movements:${mode}`);

  const records: MovementRecord[] = useMemo(() => {
    const list = data?.records ?? [];
    // Newest first: the app returns them oldest first.
    return [...list].sort((a, b) => text(b.작성일시).localeCompare(text(a.작성일시)));
  }, [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [record.상품코드, record.상품명, record.협력사명, record.센터명, record.불량사유, record.수정자]
        .map(text)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [records, query]);

  if (loading && !data) return <LoadingState label="회송/교환 내역을 불러오는 중" />;
  if (error) {
    return (
      <ErrorState
        title="회송/교환 내역을 불러올 수 없습니다"
        description={error}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }

  const returns = records.filter((record) => text(record.처리유형).includes("회송")).length;
  const exchanges = records.filter((record) => text(record.처리유형).includes("교환")).length;

  return (
    <div className="page">
      <PageHeader
        icon={<IconMovement size={20} aria-hidden />}
        title="회송 / 교환"
        description="검품 앱이 기록한 회송·교환 원본 내역입니다."
        meta={
          <>
            <MetaItem label="전체">{formatNumber(records.length)}건</MetaItem>
            <MetaItem label="회송">{formatNumber(returns)}</MetaItem>
            <MetaItem label="교환">{formatNumber(exchanges)}</MetaItem>
          </>
        }
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      <SectionCard flush>
        <div className="table-toolbar">
          <div className="table-toolbar-group">
            <Segmented label="작업 범위" value={mode} options={MODE_OPTIONS} onChange={setMode} />
            <SearchInput label="검색" value={query} onChange={setQuery} placeholder="상품, 협력사, 센터, 사유, 수정자" width={280} />
            <span className="muted">{formatNumber(filtered.length)}건</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>센터</th>
                <th>상품코드</th>
                <th>상품명</th>
                <th>협력사</th>
                <th style={{ textAlign: "right" }}>수량</th>
                <th>불량사유</th>
                <th title="개선요청 / 경고조치 / 주의조치 (처리 완료 여부가 아니라 조치 등급)">조치</th>
                <th style={{ textAlign: "right" }}>사진</th>
                <th>수정자</th>
                <th>작성일시</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((record, index) => (
                <tr key={text(record.recordId) || `${text(record.상품코드)}-${record.__rowNumber ?? index}`}>
                  <td>
                    <Badge tone={kindTone(text(record.처리유형))} size="sm">
                      {text(record.처리유형) || "-"}
                    </Badge>
                  </td>
                  <td>{text(record.센터명) || <span className="muted">-</span>}</td>
                  <td className="mono">{text(record.상품코드)}</td>
                  <td title={text(record.상품명)}>{text(record.상품명)}</td>
                  <td title={text(record.협력사명)}>{text(record.협력사명)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{formatNumber(quantityOf(record))}</td>
                  <td title={text(record.불량사유)}>{text(record.불량사유) || <span className="muted">-</span>}</td>
                  <td>{text(record.effectiveActionStatus) || <span className="muted">-</span>}</td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {number(record.사진개수) || <span className="muted">0</span>}
                  </td>
                  <td>{text(record.수정자) || <span className="muted">-</span>}</td>
                  <td className="muted">{text(record.작성일시)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title="회송/교환 내역이 없습니다" inline />}
        </div>
      </SectionCard>
    </div>
  );
}
