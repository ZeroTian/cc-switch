import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useVisibleAppIds } from "@/components/mcp/useVisibleAppIds";
import { MCP_APP_IDS, SKILLS_APP_IDS } from "@/config/appConfig";
import { APP_IDS } from "@/config/appSpecs";

vi.mock("@/lib/query", () => ({
  useSettingsQuery: () => ({
    data: {
      visibleApps: Object.fromEntries(APP_IDS.map((app) => [app, false])),
    },
  }),
}));

describe("仅管理技能的应用显示", () => {
  it("应用页的隐藏设置不影响 CatPaw Desk 的技能入口", () => {
    const { result } = renderHook(() => useVisibleAppIds(SKILLS_APP_IDS));
    expect(result.current).toEqual(["catpaw"]);
  });

  it("MCP 矩阵仍遵循应用页的隐藏设置", () => {
    const { result } = renderHook(() => useVisibleAppIds(MCP_APP_IDS));
    expect(result.current).toEqual([]);
  });
});
