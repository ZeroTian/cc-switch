import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillGroupsPanel } from "@/components/skills/SkillGroupsPanel";

vi.mock("@/hooks/useSkillGroups", () => ({
  useSkillGroups: () => ({
    data: [
      {
        id: "base",
        name: "base",
        description: "必备技能",
        isActive: true,
        apps: {
          claude: true,
          codex: false,
          gemini: false,
          opencode: false,
          hermes: false,
        },
        memberIds: [],
      },
    ],
    isLoading: false,
  }),
  useCreateSkillGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSkillGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkillGroup: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/components/skills/SkillGroupEditDialog", () => ({
  SkillGroupEditDialog: () => null,
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("@/components/mcp/useVisibleAppIds", () => ({
  useVisibleAppIds: (ids: string[]) =>
    ids.filter((id) => ["claude", "codex", "hermes", "pi"].includes(id)),
}));

describe("SkillGroupsPanel 配置职责", () => {
  it("即使分组处于全局激活状态也不显示激活复选框", () => {
    render(<SkillGroupsPanel />);

    expect(screen.getByText("base")).toBeVisible();
    expect(
      screen.getByText("管理 Skill 分组及成员；激活范围请在「工作空间」中配置"),
    ).toBeVisible();
    expect(
      screen.queryByText("将 Skill 按场景分组，一键切换当前激活集合"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("使用与已安装相同的可见应用列，只读展示适用状态", () => {
    render(<SkillGroupsPanel />);

    const row = screen.getByRole("listitem");
    const cells = within(row).getAllByRole("img");
    expect(cells).toHaveLength(4);
    expect(cells.map((cell) => cell.getAttribute("data-state"))).toEqual([
      "on",
      "off",
      "off",
      "off",
    ]);
    expect(cells[0]).toHaveAccessibleName(/Claude Code/);
    expect(cells[1]).toHaveAccessibleName(/Codex/);
    expect(cells[2]).toHaveAccessibleName(/Hermes/);
    expect(cells[3]).toHaveAccessibleName(/Pi/);
    expect(within(row).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByLabelText(/Gemini CLI/)).not.toBeInTheDocument();
  });
});
