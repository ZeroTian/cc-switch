import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";

import { WorkspacesPanel } from "@/components/skills/WorkspacesPanel";
import type { WorkspaceBindings } from "@/lib/api/workspaces";

const toggleSkillMock = vi.fn();
const toggleGroupMock = vi.fn();
let activeGroupIds: string[] = [];
const defaultInstalledSkills = [
  {
    id: "skill-a",
    name: "独立 Skill",
    description: "一个独立 Skill",
    directory: "standalone-skill",
  },
  {
    id: "skill-b",
    name: "组内 Skill",
    description: "",
    directory: "grouped-skill",
  },
];
let installedSkills = defaultInstalledSkills;
let workspaceBindings: WorkspaceBindings | undefined;
const sortingSkills = ["A", "B", "C", "D"].map((suffix) => ({
  id: `skill-${suffix.toLowerCase()}`,
  name: `Skill ${suffix}`,
  description: "",
  directory: `skill-${suffix.toLowerCase()}`,
}));
Object.freeze(sortingSkills);
let workspaces = [
  {
    id: "ws-1",
    name: "我的工作空间",
    path: "/tmp/ws1",
    isUserLevel: false,
    createdAt: 0,
    updatedAt: 0,
    groupIds: [],
  },
];
let skillGroups = [
  {
    id: "group-1",
    name: "分组一",
    description: "",
    memberIds: ["skill-b"],
  },
];

vi.mock("@/hooks/useWorkspaces", () => ({
  useWorkspaces: () => ({
    data: workspaces,
    isLoading: false,
  }),
  useCreateWorkspace: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWorkspace: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWorkspace: () => ({ mutateAsync: vi.fn() }),
  useAddGroupToWorkspace: () => ({ mutateAsync: vi.fn() }),
  useRemoveGroupFromWorkspace: () => ({ mutateAsync: vi.fn() }),
  useToggleGroupInWorkspace: () => ({ mutateAsync: toggleGroupMock }),
  useWorkspaceActiveGroupIds: () => ({ data: activeGroupIds }),
  useWorkspaceBindings: () => ({
    data: workspaceBindings,
  }),
  useToggleWorkspaceSkill: () => ({ mutateAsync: toggleSkillMock }),
}));

vi.mock("@/hooks/useSkillGroups", () => ({
  useSkillGroups: () => ({
    data: skillGroups,
  }),
}));

vi.mock("@/hooks/useSkills", () => ({
  useInstalledSkills: () => ({
    data: installedSkills,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe("WorkspacesPanel 独立 Skill 回归", () => {
  beforeEach(() => {
    toggleSkillMock.mockReset();
    toggleGroupMock.mockReset();
    toggleSkillMock.mockResolvedValue(undefined);
    toggleGroupMock.mockResolvedValue(undefined);
    activeGroupIds = [];
    installedSkills = defaultInstalledSkills;
    workspaceBindings = {
      groupIds: [],
      skillIds: ["skill-a"],
      totalSkillCount: 1,
    };
    workspaces = [
      {
        id: "ws-1",
        name: "我的工作空间",
        path: "/tmp/ws1",
        isUserLevel: false,
        createdAt: 0,
        updatedAt: 0,
        groupIds: [],
      },
    ];
    skillGroups = [
      {
        id: "group-1",
        name: "分组一",
        description: "",
        memberIds: ["skill-b"],
      },
    ];
  });

  it("展开工作空间后在分组下方显示已安装独立 Skill，且切换走独立 Skill mutation", async () => {
    render(<WorkspacesPanel />);

    // 展开工作空间
    await act(async () => {
      fireEvent.click(screen.getByText("我的工作空间"));
    });

    // 独立 Skill 在分组列表下方可见
    await waitFor(() => {
      expect(screen.getByText("独立 Skill")).toBeInTheDocument();
      expect(screen.getByText("组内 Skill")).toBeInTheDocument();
    });

    const directSkillRow = screen.getByText("独立 Skill").closest("label");
    const groupedSkillRow = screen.getByText("组内 Skill").closest("label");
    expect(directSkillRow).not.toBeNull();
    expect(groupedSkillRow).not.toBeNull();
    expect(within(directSkillRow!).getByRole("checkbox")).toBeChecked();
    expect(within(groupedSkillRow!).getByRole("checkbox")).not.toBeChecked();

    // 点击独立 Skill 触发切换
    await act(async () => {
      fireEvent.click(screen.getByText("独立 Skill"));
    });

    await waitFor(() => {
      expect(toggleSkillMock).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        skillId: "skill-a",
        active: false,
      });
    });
  });

  it("没有分组时仍显示已安装 Skill", async () => {
    skillGroups = [];
    render(<WorkspacesPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText("我的工作空间"));
    });

    expect(await screen.findByText("独立 Skill")).toBeInTheDocument();
    expect(screen.getByText("组内 Skill")).toBeInTheDocument();
  });

  it("已选 Skill 稳定置顶，两类内部保持查询顺序且不修改查询数组", async () => {
    installedSkills = sortingSkills;
    workspaceBindings = {
      groupIds: [],
      skillIds: ["skill-d", "skill-b"],
      totalSkillCount: 2,
    };
    render(<WorkspacesPanel />);
    await userEvent.click(screen.getByText("我的工作空间"));

    const checkboxes = within(
      screen.getByRole("button", { name: "Skill" }).parentElement!,
    ).getAllByRole("checkbox");
    expect(
      checkboxes.map((checkbox) => checkbox.closest("label")!.textContent),
    ).toEqual(["Skill B", "Skill D", "Skill A", "Skill C"]);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
    expect(checkboxes[3]).not.toBeChecked();
    expect(installedSkills.map((skill) => skill.id)).toEqual([
      "skill-a",
      "skill-b",
      "skill-c",
      "skill-d",
    ]);
  });

  it("绑定尚未回读时不勾选，勾选及取消后的绑定回读会重新排列 Skill", async () => {
    installedSkills = sortingSkills;
    workspaceBindings = undefined;
    const user = userEvent.setup();
    const { rerender } = render(<WorkspacesPanel />);
    await user.click(screen.getByText("我的工作空间"));
    const skillList = screen.getByRole("button", {
      name: "Skill",
    }).parentElement!;
    const skillOrder = () =>
      within(skillList)
        .getAllByRole("checkbox")
        .map((checkbox) => checkbox.closest("label")!.textContent);

    expect(skillOrder()).toEqual(["Skill A", "Skill B", "Skill C", "Skill D"]);
    for (const checkbox of within(skillList).getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }

    await user.click(screen.getByText("Skill C"));
    expect(toggleSkillMock).toHaveBeenLastCalledWith({
      workspaceId: "ws-1",
      skillId: "skill-c",
      active: true,
    });
    workspaceBindings = {
      groupIds: [],
      skillIds: ["skill-c"],
      totalSkillCount: 1,
    };
    rerender(<WorkspacesPanel />);
    expect(skillOrder()).toEqual(["Skill C", "Skill A", "Skill B", "Skill D"]);
    expect(
      within(screen.getByText("Skill C").closest("label")!).getByRole(
        "checkbox",
      ),
    ).toBeChecked();

    await user.click(screen.getByText("Skill B"));
    expect(toggleSkillMock).toHaveBeenLastCalledWith({
      workspaceId: "ws-1",
      skillId: "skill-b",
      active: true,
    });
    workspaceBindings = {
      groupIds: [],
      skillIds: ["skill-c", "skill-b"],
      totalSkillCount: 2,
    };
    rerender(<WorkspacesPanel />);
    expect(skillOrder()).toEqual(["Skill B", "Skill C", "Skill A", "Skill D"]);

    await user.click(screen.getByText("Skill C"));
    expect(toggleSkillMock).toHaveBeenLastCalledWith({
      workspaceId: "ws-1",
      skillId: "skill-c",
      active: false,
    });
    workspaceBindings = {
      groupIds: [],
      skillIds: ["skill-b"],
      totalSkillCount: 1,
    };
    rerender(<WorkspacesPanel />);
    expect(skillOrder()).toEqual(["Skill B", "Skill A", "Skill C", "Skill D"]);
    expect(
      within(screen.getByText("Skill C").closest("label")!).getByRole(
        "checkbox",
      ),
    ).not.toBeChecked();
  });

  it.each([
    { label: "无已选", skillIds: [] },
    {
      label: "全部已选",
      skillIds: ["skill-d", "skill-b", "skill-c", "skill-a"],
    },
  ])("$label Skill 时保留原查询顺序", async ({ skillIds }) => {
    installedSkills = sortingSkills;
    workspaceBindings = {
      groupIds: [],
      skillIds,
      totalSkillCount: skillIds.length,
    };
    render(<WorkspacesPanel />);
    await userEvent.click(screen.getByText("我的工作空间"));

    const checkboxes = within(
      screen.getByRole("button", { name: "Skill" }).parentElement!,
    ).getAllByRole("checkbox");
    expect(
      checkboxes.map((checkbox) => checkbox.closest("label")!.textContent),
    ).toEqual(["Skill A", "Skill B", "Skill C", "Skill D"]);
    for (const checkbox of checkboxes) {
      if (skillIds.length) expect(checkbox).toBeChecked();
      else expect(checkbox).not.toBeChecked();
    }
  });

  it.each([
    ["分组", "Skill", "分组一", "独立 Skill"],
    ["Skill", "分组", "独立 Skill", "分组一"],
  ])(
    "%s 可以独立折叠，再次展开保留勾选状态",
    async (section, otherSection, row, otherRow) => {
      activeGroupIds = ["group-1"];
      const user = userEvent.setup();
      render(<WorkspacesPanel />);
      await user.click(screen.getByText("我的工作空间"));

      const trigger = screen.getByRole("button", {
        name: section,
      });
      const otherTrigger = screen.getByRole("button", {
        name: otherSection,
      });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(otherTrigger).toHaveAttribute("aria-expanded", "true");
      expect(
        within(screen.getByText(row).closest("label")!).getByRole("checkbox"),
      ).toBeChecked();

      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(row)).not.toBeInTheDocument();
      expect(screen.getByText(otherRow)).toBeVisible();
      expect(otherTrigger).toHaveAttribute("aria-expanded", "true");

      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(
        within(screen.getByText(row).closest("label")!).getByRole("checkbox"),
      ).toBeChecked();
      expect(toggleGroupMock).not.toHaveBeenCalled();
      expect(toggleSkillMock).not.toHaveBeenCalled();
    },
  );

  it("折叠标题支持 Enter 和空格操作", async () => {
    const user = userEvent.setup();
    render(<WorkspacesPanel />);
    await user.click(screen.getByText("我的工作空间"));
    const trigger = screen.getByRole("button", { name: "分组" });
    trigger.focus();

    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("分组一")).not.toBeInTheDocument();

    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("分组一")).toBeVisible();
    expect(toggleGroupMock).not.toHaveBeenCalled();
    expect(toggleSkillMock).not.toHaveBeenCalled();
  });

  it("已勾选分组排在前面，两类内部保持原顺序且不修改查询数据", async () => {
    skillGroups = ["未勾选一", "已勾选一", "未勾选二", "已勾选二"].map(
      (name, index) => ({
        id: `group-${index + 1}`,
        name,
        description: "",
        memberIds: [],
      }),
    );
    activeGroupIds = ["group-4", "group-2"];
    render(<WorkspacesPanel />);

    await act(async () => {
      fireEvent.click(screen.getByText("我的工作空间"));
    });

    const checkboxes = within(
      screen.getByText("分组").parentElement!,
    ).getAllByRole("checkbox");
    expect(
      checkboxes.map((checkbox) => checkbox.closest("label")!.textContent),
    ).toEqual(["已勾选一", "已勾选二", "未勾选一", "未勾选二"]);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
    expect(checkboxes[3]).not.toBeChecked();
    expect(skillGroups.map((group) => group.name)).toEqual([
      "未勾选一",
      "已勾选一",
      "未勾选二",
      "已勾选二",
    ]);
  });

  it("启用状态回读更新后，勾选和取消勾选都会重新排序", async () => {
    skillGroups = ["分组一", "分组二", "分组三"].map((name, index) => ({
      id: `group-${index + 1}`,
      name,
      description: "",
      memberIds: [],
    }));
    activeGroupIds = ["group-2"];
    const { rerender } = render(<WorkspacesPanel />);
    await act(async () => {
      fireEvent.click(screen.getByText("我的工作空间"));
    });
    const groupList = screen.getByText("分组").parentElement!;

    await act(async () => {
      fireEvent.click(screen.getByText("分组三"));
    });
    expect(toggleGroupMock).toHaveBeenLastCalledWith({
      workspaceId: "ws-1",
      groupId: "group-3",
      active: true,
    });
    activeGroupIds = ["group-2", "group-3"];
    rerender(<WorkspacesPanel />);
    expect(
      within(groupList)
        .getAllByRole("checkbox")
        .map((checkbox) => checkbox.closest("label")!.textContent),
    ).toEqual(["分组二", "分组三", "分组一"]);

    await act(async () => {
      fireEvent.click(screen.getByText("分组二"));
    });
    expect(toggleGroupMock).toHaveBeenLastCalledWith({
      workspaceId: "ws-1",
      groupId: "group-2",
      active: false,
    });
    activeGroupIds = ["group-3"];
    rerender(<WorkspacesPanel />);
    expect(
      within(groupList)
        .getAllByRole("checkbox")
        .map((checkbox) => checkbox.closest("label")!.textContent),
    ).toEqual(["分组三", "分组一", "分组二"]);
  });

  it.each([[], ["group-1", "group-2", "group-3"]])(
    "无勾选或全部勾选时保持原顺序（%j）",
    async (...ids) => {
      activeGroupIds = ids;
      skillGroups = ["分组一", "分组二", "分组三"].map((name, index) => ({
        id: `group-${index + 1}`,
        name,
        description: "",
        memberIds: [],
      }));
      render(<WorkspacesPanel />);
      await act(async () => {
        fireEvent.click(screen.getByText("我的工作空间"));
      });
      expect(
        within(screen.getByText("分组").parentElement!)
          .getAllByRole("checkbox")
          .map((checkbox) => checkbox.closest("label")!.textContent),
      ).toEqual(["分组一", "分组二", "分组三"]);
    },
  );

  it("全局工作空间优先显示且隐藏编辑删除，普通工作空间保留操作", () => {
    workspaces = [
      {
        id: "project",
        name: "项目空间",
        path: "/tmp/project",
        isUserLevel: false,
        createdAt: 0,
        updatedAt: 0,
        groupIds: [],
      },
      {
        id: "user",
        name: "全局",
        path: "~",
        isUserLevel: true,
        createdAt: 0,
        updatedAt: 0,
        groupIds: [],
      },
    ];

    render(<WorkspacesPanel />);

    const globalCard = screen
      .getByText("全局")
      .closest('[role="listitem"]') as HTMLElement | null;
    const projectCard = screen
      .getByText("项目空间")
      .closest('[role="listitem"]') as HTMLElement | null;
    expect(globalCard).not.toBeNull();
    expect(projectCard).not.toBeNull();
    expect(
      globalCard!.compareDocumentPosition(projectCard!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(globalCard!).queryAllByRole("button")).toHaveLength(0);
    expect(within(projectCard!).getByLabelText(/编辑.*项目空间/)).toBeVisible();
    expect(within(projectCard!).getByLabelText(/删除.*项目空间/)).toBeVisible();
  });
});
