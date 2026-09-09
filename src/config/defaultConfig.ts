import type { CampaignConfig } from "../domain/types";

export const defaultCampaignConfig: CampaignConfig = {
  campaignId: "2026-09-1",
  campaignName: "2026년 9월 1차 전단행사",
  categoryGroups: [
    { id: "cold", label: "냉장/냉동/빵", codes: ["02", "04"] },
    { id: "fresh", label: "신선", codes: ["05", "06", "07", "08"] },
    { id: "other", label: "기타", codes: [] },
  ],
  focusUnits: [],
  targetByBusinessUnit: {},
  targetAchievementThreshold: 1,
  focusHandlingThreshold: 0.7,
  topN: 20,
  storeTypeProfitShare: {
    "GS1타입": 0.66,
    "GS2타입": 0.6,
    "GS3타입": 0.41,
    "R타입": 0.5,
    "G타입": 0.6,
  },
  wasteChargeRate: 0.5,
  wasteSupportRate: 0.5,
  focusAutoGroupCategories: ["축산"],
  storeTypeAliases: {
    "G1타입": "G타입",
    "R1타입": "R타입",
  },
};
