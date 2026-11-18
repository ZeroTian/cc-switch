import { useMemo } from "react";
import type { SkillAppId } from "@/lib/api/types";
import { DEFAULT_VISIBLE_APPS } from "@/config/appConfig";
import { useSettingsQuery } from "@/lib/query";

/**
 * MCP / Skills 矩阵只列「应用」页里设为显示的应用。隐藏只影响界面，
 * 已经写进隐藏应用的配置照常保留、照常同步。
 */
export function useVisibleAppIds<T extends SkillAppId>(
  appIds: readonly T[],
): T[] {
  const { data: settings } = useSettingsQuery();
  const visibleApps = settings?.visibleApps;
  return useMemo(() => {
    // CatPaw 只出现在技能管理中，没有供应商应用页的显示开关。
    const visible: Record<SkillAppId, boolean> = {
      ...DEFAULT_VISIBLE_APPS,
      ...visibleApps,
      catpaw: true,
    };
    return appIds.filter((app) => visible[app]);
  }, [appIds, visibleApps]);
}
