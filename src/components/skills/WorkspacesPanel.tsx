import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight, Loader2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorkspaceEditDialog } from "./WorkspaceEditDialog";
import {
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useReorderWorkspaces,
  useWorkspaceBindings,
  useToggleWorkspaceGroup,
  useToggleWorkspaceSkill,
} from "@/hooks/useWorkspaces";
import { useSkillGroups } from "@/hooks/useSkillGroups";
import { useInstalledSkills } from "@/hooks/useSkills";
import type { Workspace } from "@/lib/api/workspaces";

function WorkspaceBindingsPanel({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();
  const { data: groups = [] } = useSkillGroups();
  const { data: skills = [] } = useInstalledSkills();
  const { data: bindings } = useWorkspaceBindings(workspace.id);
  const toggleGroupMutation = useToggleWorkspaceGroup();
  const toggleSkillMutation = useToggleWorkspaceSkill();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [groupsExpanded, setGroupsExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  const boundGroupIds = new Set(bindings?.groupIds ?? []);
  const boundSkillIds = new Set(bindings?.skillIds ?? []);
  const boundGroupCount = groups.filter((g) => boundGroupIds.has(g.id)).length;
  const boundSkillCount = skills.filter((s) => boundSkillIds.has(s.id)).length;

  const sortedGroups = [...groups].sort((a, b) => {
    const aChecked = boundGroupIds.has(a.id) ? 0 : 1;
    const bChecked = boundGroupIds.has(b.id) ? 0 : 1;
    return aChecked - bChecked;
  });
  const sortedSkills = [...skills].sort((a, b) => {
    const aChecked = boundSkillIds.has(a.id) ? 0 : 1;
    const bChecked = boundSkillIds.has(b.id) ? 0 : 1;
    return aChecked - bChecked;
  });

  const handleToggleGroup = async (groupId: string, checked: boolean) => {
    setPendingId(groupId);
    try {
      await toggleGroupMutation.mutateAsync({ workspaceId: workspace.id, groupId, active: checked });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const handleToggleSkill = async (skillId: string, checked: boolean) => {
    setPendingId(skillId);
    try {
      await toggleSkillMutation.mutateAsync({ workspaceId: workspace.id, skillId, active: checked });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="border-t border-border-default bg-muted/20 px-4 py-3 space-y-2">
      {groups.length > 0 && (
        <div className="rounded-md border border-border-default overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/50 transition-colors"
            onClick={() => setGroupsExpanded((v) => !v)}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t("workspaces.bindGroups", "分组")}
              {boundGroupCount > 0 && (
                <span className="ml-1.5 text-primary">({boundGroupCount}/{groups.length})</span>
              )}
            </span>
            {groupsExpanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            }
          </button>
          {groupsExpanded && (
            <div className="border-t border-border-default px-2 py-1 space-y-0.5">
              {sortedGroups.map((group) => {
                const checked = boundGroupIds.has(group.id);
                return (
                  <button
                    type="button"
                    key={group.id}
                    className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      checked ? "bg-primary/8 hover:bg-primary/12" : "hover:bg-accent"
                    }`}
                    onClick={() => handleToggleGroup(group.id, !checked)}
                    disabled={pendingId === group.id}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${checked ? "text-primary" : ""}`}>{group.name}</div>
                      {group.description && (
                        <div className="text-xs text-muted-foreground truncate">{group.description}</div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {t("skillGroups.memberCount", "{{count}} 个 Skill", { count: group.memberIds.length })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {skills.length > 0 && (
        <div className="rounded-md border border-border-default overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/50 transition-colors"
            onClick={() => setSkillsExpanded((v) => !v)}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t("workspaces.bindSkills", "Skill")}
              {boundSkillCount > 0 && (
                <span className="ml-1.5 text-primary">({boundSkillCount}/{skills.length})</span>
              )}
            </span>
            {skillsExpanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            }
          </button>
          {skillsExpanded && (
            <div className="border-t border-border-default px-2 py-1 space-y-0.5">
              {sortedSkills.map((skill) => {
                const checked = boundSkillIds.has(skill.id);
                return (
                  <button
                    type="button"
                    key={skill.id}
                    className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      checked ? "bg-primary/8 hover:bg-primary/12" : "hover:bg-accent"
                    }`}
                    onClick={() => handleToggleSkill(skill.id, !checked)}
                    disabled={pendingId === skill.id}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${checked ? "text-primary font-medium" : ""}`}>{skill.name}</div>
                      {skill.description && (
                        <div className="text-xs text-muted-foreground truncate">{skill.description}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {groups.length === 0 && skills.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-2">
          {t("workspaces.noSkillsOrGroups", "还没有分组或 Skill，请先安装")}
        </div>
      )}

      {bindings && (
        <div className="text-xs text-muted-foreground pt-1">
          {t("workspaces.totalSkills", "共 {{count}} 个 Skill 将被同步", { count: bindings.totalSkillCount })}
        </div>
      )}
    </div>
  );
}

function SortableWorkspaceItem({
  ws,
  renderCard,
}: {
  ws: Workspace;
  renderCard: (ws: Workspace, opts?: { dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>; style?: React.CSSProperties; ref?: React.Ref<HTMLDivElement> }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ws.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return <>{renderCard(ws, { dragHandleProps: { ...attributes, ...listeners }, style, ref: setNodeRef })}</>;
}

export function WorkspacesPanel() {
  const { t } = useTranslation();
  const { data: workspaces = [], isLoading } = useWorkspaces();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [editState, setEditState] = useState<{
    open: boolean;
    workspace: Workspace | null;
  }>({ open: false, workspace: null });

  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    workspace: Workspace | null;
  }>({ open: false, workspace: null });

  const createMutation = useCreateWorkspace();
  const updateMutation = useUpdateWorkspace();
  const deleteMutation = useDeleteWorkspace();
  const reorderMutation = useReorderWorkspaces();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const userLevelWs = workspaces.find((ws) => ws.isUserLevel);
  const projectWorkspaces = workspaces.filter((ws) => !ws.isUserLevel);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projectWorkspaces.findIndex((w) => w.id === active.id);
    const newIndex = projectWorkspaces.findIndex((w) => w.id === over.id);
    const reordered = arrayMove(projectWorkspaces, oldIndex, newIndex);
    reorderMutation.mutate(reordered.map((w) => w.id));
  };

  const handleSave = async (params: { name: string; path: string }) => {
    try {
      if (editState.workspace) {
        await updateMutation.mutateAsync({ id: editState.workspace.id, ...params });
        toast.success(t("workspaces.updated", "工作空间已更新"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("workspaces.created", "工作空间已创建"));
      }
      setEditState({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.workspace) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.workspace.id);
      toast.success(t("workspaces.deleted", "工作空间已删除"));
      if (expandedId === confirmDelete.workspace.id) setExpandedId(null);
      setConfirmDelete({ open: false, workspace: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderWorkspaceCard = (
    ws: Workspace,
    opts?: { dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>; style?: React.CSSProperties; ref?: React.Ref<HTMLDivElement> }
  ) => {
    const expanded = expandedId === ws.id;
    const isUserLevel = ws.isUserLevel;
    return (
      <div
        ref={opts?.ref}
        style={opts?.style}
        className="rounded-lg border border-border-default overflow-hidden bg-background"
      >
        <div
          className="flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-accent/50 select-none"
          onClick={() => toggleExpand(ws.id)}
        >
          {!isUserLevel && (
            <button
              type="button"
              className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground shrink-0 touch-none"
              onClick={(e) => e.stopPropagation()}
              {...opts?.dragHandleProps}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{ws.name}</div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">{ws.path}</div>
          </div>
          <div
            className="flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {!isUserLevel && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditState({ open: true, workspace: ws })}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete({ open: true, workspace: ws })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        {expanded && <WorkspaceBindingsPanel workspace={ws} />}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("workspaces.description", "将项目目录与 Skill 分组绑定，一键同步到局部配置")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditState({ open: true, workspace: null })}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("workspaces.new", "新建工作空间")}
        </Button>
      </div>

      <div className="space-y-2">
        {userLevelWs && renderWorkspaceCard(userLevelWs)}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={projectWorkspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
            {projectWorkspaces.map((ws) => (
              <SortableWorkspaceItem key={ws.id} ws={ws} renderCard={renderWorkspaceCard} />
            ))}
          </SortableContext>
        </DndContext>
        {!userLevelWs && projectWorkspaces.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {t("workspaces.empty", "还没有工作空间，点击「新建工作空间」开始")}
          </div>
        )}
      </div>

      <WorkspaceEditDialog
        open={editState.open}
        workspace={editState.workspace}
        onClose={() => setEditState({ open: false, workspace: null })}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={t("workspaces.deleteTitle", "删除工作空间")}
        message={t(
          "workspaces.deleteMessage",
          "确认删除「{{name}}」？不会删除目录下已同步的 Skill 文件。",
          { name: confirmDelete.workspace?.name }
        )}
        confirmText={t("common.delete", "删除")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, workspace: null })}
      />
    </div>
  );
}
