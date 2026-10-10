import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillGroupEditDialog } from "@/components/skills/SkillGroupEditDialog";
import { skillGroupsApi, DEFAULT_GROUP_APPS } from "@/lib/api/skillGroups";
import {
  skillsApi,
  type InstalledSkill,
  type SkillGroup,
} from "@/lib/api/skills";
import { renderWithQueryClient } from "../utils/testQueryClient";

const installedSkills: InstalledSkill[] = [
  ["alpha", "Alpha Skill", "Match tag"],
  ["beta", "Beta Skill", ""],
  ["gamma", "Gamma Skill", "Match tag"],
  ["delta", "Delta Skill", "match tag"],
].map(([id, name, description]) => ({
  id,
  name,
  description,
  directory: id,
  apps: {
    claude: false,
    codex: false,
    gemini: false,
    opencode: false,
    openclaw: false,
    hermes: false,
    pi: false,
  },
  installedAt: 0,
  updatedAt: 0,
}));
Object.freeze(installedSkills);

const group: SkillGroup = {
  id: "group-1",
  name: "分组一",
  description: "分组描述",
  isActive: false,
  createdAt: 0,
  updatedAt: 0,
  apps: DEFAULT_GROUP_APPS,
  memberIds: ["delta", "beta"],
};

let memberIdsByGroup: Record<string, string[]>;

const skillSection = () => screen.getByText("选择 Skill").parentElement!;
const skillOrder = () =>
  within(skillSection())
    .getAllByRole("checkbox")
    .map(
      (checkbox) =>
        within(checkbox.closest("label")!).getByText(/ Skill$/).textContent,
    );
const skillCheckbox = (name: string) =>
  within(screen.getByText(name).closest("label")!).getByRole("checkbox");

describe("SkillGroupEditDialog 已选 Skill 排序", () => {
  beforeEach(() => {
    memberIdsByGroup = {
      "group-1": ["delta", "beta"],
      "group-2": ["gamma"],
    };
    vi.spyOn(skillsApi, "getInstalled").mockResolvedValue(installedSkills);
    vi.spyOn(skillGroupsApi, "getMemberIds").mockImplementation(async (id) => [
      ...memberIdsByGroup[id],
    ]);
    vi.spyOn(skillGroupsApi, "addSkill").mockImplementation(
      async (groupId, skillId) => {
        memberIdsByGroup[groupId] = [...memberIdsByGroup[groupId], skillId];
      },
    );
    vi.spyOn(skillGroupsApi, "removeSkill").mockImplementation(
      async (groupId, skillId) => {
        memberIdsByGroup[groupId] = memberIdsByGroup[groupId].filter(
          (id) => id !== skillId,
        );
      },
    );
  });

  it("编辑时已选项置顶，两类内部保持原顺序且不修改查询数组", async () => {
    renderWithQueryClient(
      <SkillGroupEditDialog
        open
        group={group}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await waitFor(() => expect(skillCheckbox("Beta Skill")).toBeChecked());

    expect(skillOrder()).toEqual([
      "Beta Skill",
      "Delta Skill",
      "Alpha Skill",
      "Gamma Skill",
    ]);
    expect(skillCheckbox("Delta Skill")).toBeChecked();
    expect(skillCheckbox("Alpha Skill")).not.toBeChecked();
    expect(installedSkills.map((skill) => skill.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
    ]);
  });

  it("勾选与取消成功回读后重新排序，并保持成员写入的分组与 Skill 正确", async () => {
    renderWithQueryClient(
      <SkillGroupEditDialog
        open
        group={group}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    await waitFor(() => expect(skillCheckbox("Beta Skill")).toBeChecked());

    await userEvent.click(skillCheckbox("Gamma Skill"));

    await waitFor(() => {
      expect(skillCheckbox("Gamma Skill")).toBeChecked();
      expect(skillOrder()).toEqual([
        "Beta Skill",
        "Gamma Skill",
        "Delta Skill",
        "Alpha Skill",
      ]);
    });
    expect(skillGroupsApi.addSkill).toHaveBeenCalledWith("group-1", "gamma");

    await userEvent.click(skillCheckbox("Beta Skill"));

    await waitFor(() => {
      expect(skillCheckbox("Beta Skill")).not.toBeChecked();
      expect(skillOrder()).toEqual([
        "Gamma Skill",
        "Delta Skill",
        "Alpha Skill",
        "Beta Skill",
      ]);
    });
    expect(skillGroupsApi.removeSkill).toHaveBeenCalledWith("group-1", "beta");
  });

  it("名称与描述搜索不区分大小写，筛选后仍将已选项置顶", async () => {
    renderWithQueryClient(
      <SkillGroupEditDialog
        open
        group={group}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    await waitFor(() => expect(skillCheckbox("Delta Skill")).toBeChecked());

    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索 Skill" }),
      "MATCH",
    );
    expect(skillOrder()).toEqual(["Delta Skill", "Alpha Skill", "Gamma Skill"]);
    expect(screen.queryByText("Beta Skill")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole("textbox", { name: "搜索 Skill" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索 Skill" }),
      "BETA",
    );
    expect(skillOrder()).toEqual(["Beta Skill"]);
    expect(skillCheckbox("Beta Skill")).toBeChecked();

    await userEvent.clear(screen.getByRole("textbox", { name: "搜索 Skill" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索 Skill" }),
      "missing",
    );
    expect(screen.getByText("没有已安装的 Skill")).toBeVisible();
    expect(
      within(skillSection()).queryByRole("checkbox"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(skillOrder()).toEqual([
      "Beta Skill",
      "Delta Skill",
      "Alpha Skill",
      "Gamma Skill",
    ]);
  });

  it("列表重排后保存仍提交编辑的分组信息，成员通过原接口即时更新", async () => {
    const onSave = vi.fn();
    renderWithQueryClient(
      <SkillGroupEditDialog
        open
        group={group}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    await waitFor(() => expect(skillCheckbox("Beta Skill")).toBeChecked());
    await userEvent.click(skillCheckbox("Gamma Skill"));
    await waitFor(() => expect(skillCheckbox("Gamma Skill")).toBeChecked());

    await userEvent.clear(screen.getByRole("textbox", { name: "分组名称" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "分组名称" }),
      "  新名称  ",
    );
    await userEvent.clear(
      screen.getByRole("textbox", { name: "描述（可选）" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "描述（可选）" }),
      "  新描述  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "新名称",
      description: "新描述",
      apps: DEFAULT_GROUP_APPS,
    });
    expect(memberIdsByGroup["group-1"]).toEqual(["delta", "beta", "gamma"]);
  });

  it("切换分组重置搜索，使用新分组的成员排序且不串状态", async () => {
    const props = { open: true, onClose: vi.fn(), onSave: vi.fn() };
    const { rerender } = renderWithQueryClient(
      <SkillGroupEditDialog {...props} group={group} />,
    );
    await waitFor(() => expect(skillCheckbox("Beta Skill")).toBeChecked());
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索 Skill" }),
      "delta",
    );

    rerender(
      <SkillGroupEditDialog
        {...props}
        group={{
          ...group,
          id: "group-2",
          name: "分组二",
          memberIds: ["gamma"],
        }}
      />,
    );

    await waitFor(() => expect(skillCheckbox("Gamma Skill")).toBeChecked());
    expect(screen.getByRole("textbox", { name: "搜索 Skill" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "分组名称" })).toHaveValue(
      "分组二",
    );
    expect(skillCheckbox("Beta Skill")).not.toBeChecked();
    expect(skillCheckbox("Delta Skill")).not.toBeChecked();
    expect(skillOrder()).toEqual([
      "Gamma Skill",
      "Alpha Skill",
      "Beta Skill",
      "Delta Skill",
    ]);
  });
});
