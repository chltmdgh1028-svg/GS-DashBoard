import { useEffect, useMemo, useState } from "react";
import type { CampaignConfig } from "../domain/types";
import { Badge, Button, DefinitionList, Notice, PageHeader, SectionCard, Textarea, useToast } from "../ui";
import { IconInfo, IconSettings } from "../ui/icons";
import { formatNumber, formatPercent } from "../view-models/format";

export function SettingsView({
  config,
  onApply,
  onReset,
}: {
  config: CampaignConfig;
  onApply: (config: CampaignConfig) => void;
  onReset: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(JSON.stringify(config, null, 2));
    setError("");
  }, [config]);

  const dirty = useMemo(() => draft !== JSON.stringify(config, null, 2), [draft, config]);

  function apply() {
    try {
      const parsed = JSON.parse(draft) as CampaignConfig;
      if (!parsed.campaignId || !parsed.campaignName) {
        setError("campaignId와 campaignName은 반드시 있어야 합니다.");
        return;
      }
      setError("");
      onApply(parsed);
      toast({
        tone: "success",
        title: "설정을 반영했습니다",
        description: "다음 Campaign 반영부터 적용됩니다.",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "JSON 형식을 확인하세요.");
    }
  }

  return (
    <div className="page">
      <PageHeader
        icon={<IconSettings size={20} aria-hidden />}
        title="설정"
        description="Campaign Snapshot을 만들 때 사용할 계산 기준입니다. 이미 반영된 Revision의 숫자는 바뀌지 않습니다."
        actions={
          <>
            <Button variant="secondary" onClick={onReset}>
              기본값으로
            </Button>
            <Button variant="primary" disabled={!dirty} onClick={apply}>
              설정 반영
            </Button>
          </>
        }
      />

      <Notice tone="info" icon={<IconInfo size={15} aria-hidden />} title="적용 시점">
        <span>여기서 저장한 값은 다음 [Campaign 반영]부터 사용됩니다. 과거 Revision은 반영 당시 설정을 그대로 유지합니다.</span>
      </Notice>

      <div className="grid-2" data-ratio="wide-right">
        <SectionCard title="현재 적용 기준">
          <DefinitionList
            items={[
              { term: "Campaign", value: `${config.campaignName} (${config.campaignId})` },
              {
                term: "기준기간",
                value: config.startDate ? `${config.startDate} ~ ${config.endDate ?? ""}` : "미지정",
              },
              {
                term: "카테고리 그룹",
                value: (
                  <span className="row">
                    {config.categoryGroups.map((group) => (
                      <Badge key={group.id} tone="neutral" size="sm">
                        {group.label}
                        {group.codes.length > 0 ? ` (${group.codes.join(",")})` : ""}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              { term: "중점 기준", value: `취급률 ${formatPercent(config.focusHandlingThreshold, 0)} 이상` },
              { term: "목표 기준", value: `달성률 ${formatPercent(config.targetAchievementThreshold, 0)} 이상` },
              {
                term: "부문 목표",
                value:
                  Object.keys(config.targetByBusinessUnit).length === 0
                    ? "미등록 (목표 KPI 비활성)"
                    : `${formatNumber(Object.keys(config.targetByBusinessUnit).length)}개 부문`,
              },
              { term: "상품 TOP", value: `${formatNumber(config.topN)}개` },
              {
                term: "손익 배분율",
                value: `${formatNumber(Object.keys(config.storeTypeProfitShare).length)}개 점포타입`,
              },
              {
                term: "폐기 기준",
                value: `부담률 ${formatPercent(config.wasteChargeRate, 0)} · 지원률 ${formatPercent(config.wasteSupportRate, 0)}`,
              },
              { term: "Focus Unit", value: config.focusUnits.length ? `${formatNumber(config.focusUnits.length)}개 직접 정의` : "자동 구성" },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="설정 JSON"
          subtitle={dirty ? "저장되지 않은 변경 있음" : "현재 적용 중"}
          actions={
            dirty && (
              <Button variant="ghost" onClick={() => setDraft(JSON.stringify(config, null, 2))}>
                변경 취소
              </Button>
            )
          }
        >
          <div className="stack" data-gap="sm">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={26}
              spellCheck={false}
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)" }}
              aria-label="Campaign 설정 JSON"
            />
            {error && (
              <Notice tone="danger" title="JSON을 반영하지 못했습니다">
                <span>{error}</span>
              </Notice>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
