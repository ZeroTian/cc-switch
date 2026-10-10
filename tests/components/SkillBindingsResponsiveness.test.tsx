import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillGroupEditDialog } from "@/components/skills/SkillGroupEditDialog";
import { WorkspacesPanel } from "@/components/skills/WorkspacesPanel";
import { DEFAULT_GROUP_APPS, skillGroupsApi } from "@/lib/api/skillGroups";
import {
  skillsApi,
  type InstalledSkill,
  type SkillGroup,
} from "@/lib/api/skills";
import { workspacesApi, type WorkspaceBindings } from "@/lib/api/workspaces";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const skills: InstalledSkill[] = ["Alpha", "Beta", "Gamma"].map((name) => ({
  id: name.toLowerCase(),
  name: `${name} Skill`,
  description: "",
  directory: name.toLowerCase(),
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

const group: SkillGroup = {
  id: "group-1",
  name: "分组一",
  description: "",
  isActive: false,
  createdAt: 0,
  updatedAt: 0,
  apps: DEFAULT_GROUP_APPS,
  memberIds: ["beta"],
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const checkbox = (name: string) =>
  within(screen.getByText(name).closest("label")!).getByRole("checkbox");

let backend: { memberIds: string[]; groupIds: string[]; skillIds: string[] };
let clients: QueryClient[];

function mount(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

async function mountGroup() {
  const client = mount(
    <SkillGroupEditDialog
      open
      group={group}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  await waitFor(() => expect(checkbox("Beta Skill")).toBeChecked());
  return client;
}

async function mountWorkspace() {
  const client = mount(<WorkspacesPanel />);
  await userEvent.click(await screen.findByText("工作空间一"));
  await waitFor(() => {
    expect(
      client.getQueryData(["workspaces", "bindings", "ws-1"]),
    ).toBeDefined();
    expect(checkbox("Alpha Skill")).toBeEnabled();
  });
  return client;
}

beforeEach(() => {
  clients = [];
  backend = { memberIds: ["beta"], groupIds: [], skillIds: [] };
  // Query responses are snapshots, not references mutated by optimistic updates.
  const state = backend;
  vi.spyOn(skillsApi, "getInstalled").mockResolvedValue(skills);
  vi.spyOn(skillGroupsApi, "getAll").mockImplementation(async () => [
    { ...group, memberIds: [...state.memberIds] },
  ]);
  vi.spyOn(skillGroupsApi, "getMemberIds").mockImplementation(async () => [
    ...state.memberIds,
  ]);
  vi.spyOn(skillGroupsApi, "addSkill").mockImplementation(
    async (_groupId, skillId) => {
      state.memberIds.push(skillId);
    },
  );
  vi.spyOn(skillGroupsApi, "removeSkill").mockImplementation(
    async (_groupId, skillId) => {
      state.memberIds = state.memberIds.filter((id) => id !== skillId);
    },
  );
  vi.spyOn(workspacesApi, "getAll").mockResolvedValue([
    {
      id: "ws-1",
      name: "工作空间一",
      path: "/tmp/skill-bindings-test",
      isUserLevel: false,
      createdAt: 0,
      updatedAt: 0,
      groupIds: ["group-1"],
    },
  ]);
  vi.spyOn(workspacesApi, "getActiveGroupIds").mockImplementation(async () => [
    ...state.groupIds,
  ]);
  vi.spyOn(workspacesApi, "getBindings").mockImplementation(async () => ({
    groupIds: [...state.groupIds],
    skillIds: [...state.skillIds],
    totalSkillCount: new Set([
      ...state.skillIds,
      ...(state.groupIds.includes("group-1") ? state.memberIds : []),
    ]).size,
  }));
  vi.spyOn(workspacesApi, "toggleSkill").mockRejectedValue(
    new Error("非预期 Skill 写入"),
  );
  vi.spyOn(workspacesApi, "toggleGroupActive").mockRejectedValue(
    new Error("非预期分组写入"),
  );
});

afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe("技能绑定即时反馈", () => {
  it("分组添加在后端未完成时勾选并置顶，其他行仍可选择", async () => {
    const write = deferred();
    vi.mocked(skillGroupsApi.addSkill).mockImplementationOnce(
      async (_groupId, skillId) => {
        await write.promise;
        backend.memberIds.push(skillId);
      },
    );
    const client = await mountGroup();

    await userEvent.click(checkbox("Gamma Skill"));

    expect(checkbox("Gamma Skill")).toBeChecked();
    expect(checkbox("Gamma Skill")).toBeDisabled();
    expect(checkbox("Alpha Skill")).toBeEnabled();
    expect(checkbox("Beta Skill")).toBeEnabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    const section = screen.getByText("选择 Skill").parentElement!;
    expect(
      within(section)
        .getAllByRole("checkbox")
        .map((row) => row.closest("label")!.textContent),
    ).toEqual(["Beta Skill", "Gamma Skill", "Alpha Skill"]);

    await act(async () => write.resolve());
    await waitFor(() => expect(checkbox("Gamma Skill")).toBeEnabled());
    expect(skillGroupsApi.addSkill).toHaveBeenCalledWith("group-1", "gamma");
    expect(client.getQueryData(["skillGroups", "members", "group-1"])).toEqual([
      "beta",
      "gamma",
    ]);
  });

  it("分组取消勾选立即反馈，最终回读确认成员移除", async () => {
    const write = deferred();
    vi.mocked(skillGroupsApi.removeSkill).mockImplementationOnce(
      async (_groupId, skillId) => {
        await write.promise;
        backend.memberIds = backend.memberIds.filter((id) => id !== skillId);
      },
    );
    const client = await mountGroup();

    await userEvent.click(checkbox("Beta Skill"));

    expect(checkbox("Beta Skill")).not.toBeChecked();
    expect(checkbox("Alpha Skill")).toBeEnabled();
    await act(async () => write.resolve());
    await waitFor(() => expect(checkbox("Beta Skill")).toBeEnabled());
    expect(skillGroupsApi.removeSkill).toHaveBeenCalledWith("group-1", "beta");
    expect(client.getQueryData(["skillGroups", "members", "group-1"])).toEqual(
      [],
    );
  });

  it("连续选择分组成员立即反馈并按顺序写入，中间回读不覆盖排队选择", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(skillGroupsApi.addSkill).mockImplementation(
      async (_groupId, skillId) => {
        await (skillId === "alpha" ? first.promise : second.promise);
        backend.memberIds.push(skillId);
      },
    );
    const client = await mountGroup();

    await userEvent.click(checkbox("Alpha Skill"));
    await userEvent.click(checkbox("Gamma Skill"));

    expect(checkbox("Alpha Skill")).toBeChecked();
    expect(checkbox("Gamma Skill")).toBeChecked();
    expect(checkbox("Alpha Skill")).toBeDisabled();
    expect(checkbox("Gamma Skill")).toBeDisabled();
    expect(skillGroupsApi.addSkill).toHaveBeenCalledTimes(1);
    expect(skillGroupsApi.addSkill).toHaveBeenNthCalledWith(
      1,
      "group-1",
      "alpha",
    );

    await act(async () => first.resolve());
    await waitFor(() =>
      expect(skillGroupsApi.addSkill).toHaveBeenCalledTimes(2),
    );
    expect(skillGroupsApi.addSkill).toHaveBeenNthCalledWith(
      2,
      "group-1",
      "gamma",
    );
    expect(checkbox("Alpha Skill")).toBeChecked();
    expect(checkbox("Gamma Skill")).toBeChecked();
    expect(checkbox("Gamma Skill")).toBeDisabled();

    await act(async () => second.resolve());
    await waitFor(() => expect(checkbox("Gamma Skill")).toBeEnabled());
    expect(client.getQueryData(["skillGroups", "members", "group-1"])).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("分组写入失败只恢复失败项，保留另一排队选择并提示错误", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(skillGroupsApi.addSkill).mockImplementation(
      async (_groupId, skillId) => {
        await (skillId === "alpha" ? first.promise : second.promise);
        backend.memberIds.push(skillId);
      },
    );
    const client = await mountGroup();
    await userEvent.click(checkbox("Alpha Skill"));
    await userEvent.click(checkbox("Gamma Skill"));
    expect(checkbox("Gamma Skill")).toBeChecked();

    await act(async () => first.reject(new Error("成员同步失败")));
    await waitFor(() =>
      expect(skillGroupsApi.addSkill).toHaveBeenCalledTimes(2),
    );

    expect(checkbox("Alpha Skill")).not.toBeChecked();
    expect(checkbox("Beta Skill")).toBeChecked();
    expect(checkbox("Gamma Skill")).toBeChecked();
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), {
      description: expect.stringContaining("成员同步失败"),
    });

    await act(async () => second.resolve());
    await waitFor(() => expect(checkbox("Gamma Skill")).toBeEnabled());
    expect(client.getQueryData(["skillGroups", "members", "group-1"])).toEqual([
      "beta",
      "gamma",
    ]);
  });

  it("工作空间 Skill 与分组立即勾选、共用写入顺序，重叠成员只计数一次", async () => {
    const skillWrite = deferred();
    const groupWrite = deferred();
    vi.mocked(workspacesApi.toggleSkill).mockImplementationOnce(
      async (_workspaceId, skillId) => {
        await skillWrite.promise;
        backend.skillIds.push(skillId);
      },
    );
    vi.mocked(workspacesApi.toggleGroupActive).mockImplementationOnce(
      async (_workspaceId, groupId) => {
        await groupWrite.promise;
        backend.groupIds.push(groupId);
      },
    );
    const client = await mountWorkspace();

    await userEvent.click(checkbox("Beta Skill"));
    expect(checkbox("Beta Skill")).toBeChecked();
    expect(checkbox("Alpha Skill")).toBeEnabled();
    await userEvent.click(checkbox("分组一"));
    expect(checkbox("分组一")).toBeChecked();
    expect(checkbox("Beta Skill")).toBeDisabled();
    expect(checkbox("分组一")).toBeDisabled();
    expect(screen.getByText("共 1 个 Skill 将被同步")).toBeVisible();
    expect(workspacesApi.toggleSkill).toHaveBeenCalledWith(
      "ws-1",
      "beta",
      true,
    );
    expect(workspacesApi.toggleGroupActive).not.toHaveBeenCalled();

    await act(async () => skillWrite.resolve());
    await waitFor(() =>
      expect(workspacesApi.toggleGroupActive).toHaveBeenCalledWith(
        "ws-1",
        "group-1",
        true,
      ),
    );
    expect(checkbox("分组一")).toBeChecked();
    expect(checkbox("Beta Skill")).toBeChecked();
    expect(screen.getByText("共 1 个 Skill 将被同步")).toBeVisible();

    await act(async () => groupWrite.resolve());
    await waitFor(() => expect(checkbox("分组一")).toBeEnabled());
    expect(
      client.getQueryData<WorkspaceBindings>([
        "workspaces",
        "bindings",
        "ws-1",
      ]),
    ).toEqual({
      groupIds: ["group-1"],
      skillIds: ["beta"],
      totalSkillCount: 1,
    });
    expect(client.getQueryData(["workspaces", "activeGroups", "ws-1"])).toEqual(
      ["group-1"],
    );
  });

  it("工作空间连续选择 Skill 时每个等待中的行分别禁用，完成第一项不会释放第二项", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(workspacesApi.toggleSkill).mockImplementation(
      async (_workspaceId, skillId) => {
        await (skillId === "alpha" ? first.promise : second.promise);
        backend.skillIds.push(skillId);
      },
    );
    const client = await mountWorkspace();

    await userEvent.click(checkbox("Alpha Skill"));
    await userEvent.click(checkbox("Beta Skill"));

    expect(checkbox("Alpha Skill")).toBeChecked();
    expect(checkbox("Beta Skill")).toBeChecked();
    expect(checkbox("Alpha Skill")).toBeDisabled();
    expect(checkbox("Beta Skill")).toBeDisabled();
    expect(checkbox("Gamma Skill")).toBeEnabled();
    expect(workspacesApi.toggleSkill).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve());
    await waitFor(() =>
      expect(workspacesApi.toggleSkill).toHaveBeenCalledTimes(2),
    );
    expect(checkbox("Beta Skill")).toBeChecked();
    expect(checkbox("Beta Skill")).toBeDisabled();
    expect(checkbox("Alpha Skill")).toBeEnabled();

    await act(async () => second.resolve());
    await waitFor(() => expect(checkbox("Beta Skill")).toBeEnabled());
    expect(client.getQueryData(["workspaces", "bindings", "ws-1"])).toEqual({
      groupIds: [],
      skillIds: ["alpha", "beta"],
      totalSkillCount: 2,
    });
  });

  it.each(["Skill", "分组"])(
    "工作空间取消 %s 立即反馈，保留另一来源的重叠技能",
    async (target) => {
      backend.groupIds = ["group-1"];
      backend.skillIds = ["beta"];
      const write = deferred();
      if (target === "Skill") {
        vi.mocked(workspacesApi.toggleSkill).mockImplementationOnce(
          async () => {
            await write.promise;
            backend.skillIds = [];
          },
        );
      } else {
        vi.mocked(workspacesApi.toggleGroupActive).mockImplementationOnce(
          async () => {
            await write.promise;
            backend.groupIds = [];
          },
        );
      }
      const client = await mountWorkspace();
      const row = target === "Skill" ? "Beta Skill" : "分组一";
      const otherRow = target === "Skill" ? "分组一" : "Beta Skill";
      await waitFor(() => expect(checkbox(row)).toBeChecked());

      await userEvent.click(checkbox(row));

      expect(checkbox(row)).not.toBeChecked();
      expect(checkbox(otherRow)).toBeChecked();
      expect(screen.getByText("共 1 个 Skill 将被同步")).toBeVisible();
      if (target === "Skill") {
        expect(workspacesApi.toggleSkill).toHaveBeenCalledWith(
          "ws-1",
          "beta",
          false,
        );
      } else {
        expect(workspacesApi.toggleGroupActive).toHaveBeenCalledWith(
          "ws-1",
          "group-1",
          false,
        );
      }
      await act(async () => write.resolve());
      await waitFor(() => expect(checkbox(row)).toBeEnabled());
      expect(client.getQueryData(["workspaces", "bindings", "ws-1"])).toEqual(
        target === "Skill"
          ? { groupIds: ["group-1"], skillIds: [], totalSkillCount: 1 }
          : { groupIds: [], skillIds: ["beta"], totalSkillCount: 1 },
      );
    },
  );

  it.each([false, true])(
    "工作空间失败后按权威回读恢复，数据库已写入=%s",
    async (persisted) => {
      const write = deferred();
      vi.mocked(workspacesApi.toggleSkill).mockImplementationOnce(async () => {
        await write.promise;
        if (persisted) backend.skillIds = ["alpha"];
        throw new Error("工作空间同步失败");
      });
      const client = await mountWorkspace();
      await userEvent.click(checkbox("Alpha Skill"));
      expect(checkbox("Alpha Skill")).toBeChecked();
      expect(workspacesApi.toggleSkill).toHaveBeenCalledWith(
        "ws-1",
        "alpha",
        true,
      );

      await act(async () => write.resolve());

      await waitFor(() => expect(checkbox("Alpha Skill")).toBeEnabled());
      expect(toast.error).toHaveBeenCalledWith(expect.any(String), {
        description: expect.stringContaining("工作空间同步失败"),
      });
      if (persisted) expect(checkbox("Alpha Skill")).toBeChecked();
      else expect(checkbox("Alpha Skill")).not.toBeChecked();
      expect(client.getQueryData(["workspaces", "bindings", "ws-1"])).toEqual(
        persisted
          ? { groupIds: [], skillIds: ["alpha"], totalSkillCount: 1 }
          : { groupIds: [], skillIds: [], totalSkillCount: 0 },
      );
    },
  );
});
