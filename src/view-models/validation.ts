/**
 * Validation presentation layer.
 *
 * The verified parser emits {severity, category, title, detail, entityId}.
 * This file adds the operator-facing reading of each known issue - 원인 /
 * 영향 / 확인할 내용 - so the validation screen reads like an instruction to a
 * person, not like a developer log. Unknown titles fall back to the raw detail.
 */
import type { QualityCategory, QualityIssue, Severity } from "../domain/types";

export const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export const severityLabels: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export const categoryLabels: Record<QualityCategory, string> = {
  actualData: "실제 데이터 오류",
  masterOrganization: "Master / 조직도 불일치",
  coverage: "Coverage 차이",
  configuration: "Configuration 누락",
  displayAlias: "표기 Alias",
};

export interface IssueGuide {
  /** 왜 생겼는가 */
  cause: string;
  /** 그대로 두면 어떤 숫자가 흔들리는가 */
  impact: string;
  /** 담당자가 무엇을 확인해야 하는가 */
  checklist: string;
}

const guides: Record<string, IssueGuide> = {
  "필수 파일 누락": {
    cause: "지정한 폴더에서 해당 역할의 Excel 파일을 찾지 못했습니다.",
    impact: "해당 자료가 들어가는 KPI 전체가 계산되지 않습니다.",
    checklist: "데이터 관리 화면의 파일 목록에서 누락된 자료명을 확인하고 폴더에 최신 파일을 넣은 뒤 다시 확인하세요.",
  },
  "영업일수 0": {
    cause: "영업일수 파일에서 점포 행은 찾았지만 값이 0이거나 비어 있습니다.",
    impact: "일매출(총매출÷영업일수) 계산이 불가능해 해당 점포가 일매출 지표에서 제외됩니다.",
    checklist: "영업일수 원본에서 해당 점포 행의 값을 확인하세요. 미영업/신규점이면 정상일 수 있습니다.",
  },
  "영업일수 누락": {
    cause: "실적 데이터는 있으나 영업일수 파일에서 매칭되는 행(코드/점포명)을 찾지 못했습니다.",
    impact: "일매출 관련 KPI가 비어 보입니다.",
    checklist: "영업일수 파일의 점포코드·점포명 표기가 Master와 같은지 확인하세요.",
  },
  "동일 Current Code 중복": {
    cause: "점포 Master에 같은 현재코드가 두 번 이상 존재합니다.",
    impact: "실적이 어느 행에 붙을지 불확실해 점포 단위 숫자가 왜곡될 수 있습니다.",
    checklist: "Master 파일에서 해당 코드의 중복 행을 정리하세요.",
  },
  "Alias 충돌": {
    cause: "같은 코드/명칭이 여러 점포에 연결되어 있습니다.",
    impact: "원시자료가 잘못된 점포에 매칭될 수 있습니다.",
    checklist: "Master의 최초코드·현재코드·V코드 표기를 확인하세요.",
  },
  "점포명 fallback 매칭": {
    cause: "코드로 매칭되지 않아 점포명으로 연결했습니다.",
    impact: "동명 점포가 있으면 실적이 잘못 붙을 수 있습니다.",
    checklist: "해당 점포의 원시자료 코드 표기를 확인하세요.",
  },
  "동명이점 자동 병합 보류": {
    cause: "같은 이름의 점포가 여러 개라 자동 병합하지 않았습니다.",
    impact: "해당 행의 실적이 어느 점포에도 반영되지 않았을 수 있습니다.",
    checklist: "원시자료에 점포코드를 채워 다시 추출하세요.",
  },
  "Raw에는 있으나 Master에 없음": {
    cause: "원시자료에 있는 점포가 신선강화 점포 Master에 없습니다.",
    impact: "해당 점포 실적이 집계에서 빠집니다.",
    checklist: "신규 개점/전환 점포인지 확인하고 Master를 갱신하세요.",
  },
  "Master에는 있으나 실적 데이터 없음": {
    cause: "Master에는 있으나 어떤 원시자료에도 실적 행이 없습니다.",
    impact: "점포 수에는 잡히지만 매출이 0으로 보입니다.",
    checklist: "신규점·미영업·행사 비대상 여부를 확인하세요. 정상 사유면 조치 없이 종료해도 됩니다.",
  },
  "Master와 조직도 불일치": {
    cause: "점포 Master와 조직도의 부문/팀/OFC/점포타입 값이 다릅니다.",
    impact: "조직도를 Source of Truth로 사용하므로 Master 기준 보고서와 숫자가 달라 보일 수 있습니다.",
    checklist: "조직도 최신본이 맞는지 확인하고, 맞다면 Master를 갱신하세요.",
  },
  "OFC 표기 Alias 적용": {
    cause: "Master와 조직도의 OFC 이름 표기만 다릅니다(동명이인 구분 번호 등).",
    impact: "숫자에는 영향이 없습니다. 화면에는 조직도 표기를 사용합니다.",
    checklist: "확인만 하면 되는 정상 항목입니다.",
  },
  "동일 Product Code의 Product Name 충돌": {
    cause: "같은 상품코드에 서로 다른 상품명이 들어 있습니다.",
    impact: "상품 목록 표기가 파일에 따라 달라 보일 수 있습니다.",
    checklist: "상품 원시자료의 상품명 표기를 확인하세요.",
  },
  "중점상품 Focus Unit 설정 없음": {
    cause: "중점취급상품 원시자료에서 Focus Unit을 만들 수 없었습니다.",
    impact: "중점상품 취급률 KPI가 계산되지 않습니다.",
    checklist: "중점취급상품 파일 양식과 설정 화면의 focusUnits를 확인하세요.",
  },
  "Focus Unit 자동 구성": {
    cause: "설정에 Focus Unit이 없어 상품명 계열 기준으로 자동 구성했습니다.",
    impact: "묶음 기준이 현업 기준과 다를 수 있습니다.",
    checklist: "설정 화면에서 focusUnits를 직접 정의하면 자동 구성 대신 그대로 사용합니다.",
  },
  "목표 데이터 미등록": {
    cause: "전단행사 목표 파일 또는 설정의 targetByBusinessUnit이 비어 있습니다.",
    impact: "목표 달성 관련 KPI가 비활성화됩니다.",
    checklist: "목표를 사용하려면 설정 화면에서 부문별 목표 일매출을 입력하세요.",
  },
  "손익 기준 미등록": {
    cause: "해당 점포타입의 이익 배분율이 설정에 없습니다.",
    impact: "그 점포의 추정 점포이익이 계산되지 않습니다.",
    checklist: "설정 화면의 storeTypeProfitShare에 점포타입을 추가하거나 storeTypeAliases로 기존 타입에 연결하세요.",
  },
};

export function guideFor(issue: QualityIssue): IssueGuide {
  return (
    guides[issue.title] ?? {
      cause: "자동 분류되지 않은 항목입니다.",
      impact: "영향 범위를 원본 내용으로 확인해야 합니다.",
      checklist: "아래 상세 내용을 확인하세요.",
    }
  );
}

export interface IssueGroup {
  title: string;
  severity: Severity;
  category: QualityCategory;
  count: number;
  guide: IssueGuide;
  items: QualityIssue[];
}

/** Group by issue title so 25 alias notices read as one line, not 25 rows. */
export function groupIssues(issues: QualityIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.category}|${issue.title}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.items.push(issue);
      continue;
    }
    groups.set(key, {
      title: issue.title,
      severity: issue.severity,
      category: issue.category,
      count: 1,
      guide: guideFor(issue),
      items: [issue],
    });
  }
  return [...groups.values()].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.count - a.count,
  );
}

export function countBySeverity(issues: QualityIssue[]) {
  return {
    error: issues.filter((issue) => issue.severity === "error").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length,
  };
}
