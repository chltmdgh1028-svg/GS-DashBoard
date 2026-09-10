import type { ComponentType, SVGProps } from "react";
import {
  IconDataManagement,
  IconFocus,
  IconNational,
  IconOfc,
  IconRevision,
  IconSettings,
  IconStore,
  IconTeam,
  IconValidation,
} from "./ui/icons";

export type ViewId =
  | "national"
  | "team"
  | "ofc"
  | "store"
  | "focus"
  | "data"
  | "validation"
  | "campaign"
  | "settings";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export interface NavItem {
  id: ViewId;
  label: string;
  icon: IconComponent;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const dashboardItems: NavItem[] = [
  { id: "national", label: "전국 현황", icon: IconNational },
  { id: "team", label: "팀 현황", icon: IconTeam },
  { id: "ofc", label: "OFC 현황", icon: IconOfc },
  { id: "store", label: "점포 현황", icon: IconStore },
  { id: "focus", label: "중점상품", icon: IconFocus },
];

/**
 * Role decides the menu. An OFC never sees admin entries at all - hiding them
 * is clearer than showing a menu that always answers "권한 없음".
 */
export function navigationFor(role: "admin" | "ofc"): NavGroup[] {
  if (role === "admin") {
    return [
      { id: "dashboard", label: "Dashboard", items: dashboardItems },
      {
        id: "admin",
        label: "관리자",
        items: [
          { id: "data", label: "데이터 관리", icon: IconDataManagement },
          { id: "validation", label: "데이터 검증", icon: IconValidation },
          { id: "campaign", label: "Campaign / Revision", icon: IconRevision },
          { id: "settings", label: "설정", icon: IconSettings },
        ],
      },
    ];
  }

  return [
    {
      id: "mine",
      label: "내 담당",
      items: [
        { id: "ofc", label: "OFC 현황", icon: IconOfc },
        { id: "store", label: "점포 현황", icon: IconStore },
        { id: "focus", label: "중점상품", icon: IconFocus },
      ],
    },
    {
      id: "summary",
      label: "전사 현황",
      items: [
        { id: "team", label: "팀 현황", icon: IconTeam },
        { id: "national", label: "전국 현황", icon: IconNational },
      ],
    },
  ];
}

export const adminOnlyViews: ViewId[] = ["data", "validation", "campaign", "settings"];

export function defaultViewFor(role: "admin" | "ofc"): ViewId {
  return role === "admin" ? "national" : "ofc";
}
