import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, Loader2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
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
import { SkillGroupEditDialog } from "./SkillGroupEditDialog";
import {
  useSkillGroups,
  useCreateSkillGroup,
  useUpdateSkillGroup,
  useDeleteSkillGroup,
  useReorderSkillGroups,
} from "@/hooks/useSkillGroups";
import type { SkillGroup } from "@/lib/api/skills";

function SortableGroupItem({
  group,
  onEdit,
  onDelete,
}: {
  group: SkillGroup;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-4 rounded-lg px-4 py-3 border border-border-default bg-background"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground shrink-0 touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm">{group.name}</span>
        {group.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{group.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {group.memberIds.length} 个 Skill
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function SkillGroupsPanel() {
  const { t } = useTranslation();
  const { data: groups = [], isLoading } = useSkillGroups();

  const [editDialogState, setEditDialogState] = useState<{
    open: boolean;
    group: SkillGroup | null;
  }>({ open: false, group: null });

  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    group: SkillGroup | null;
  }>({ open: false, group: null });

  const createMutation = useCreateSkillGroup();
  const updateMutation = useUpdateSkillGroup();
  const deleteMutation = useDeleteSkillGroup();
  const reorderMutation = useReorderSkillGroups();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);
    const reordered = arrayMove(groups, oldIndex, newIndex);
    reorderMutation.mutate(reordered.map((g) => g.id));
  };

  const handleSave = async (params: { name: string; description?: string; memberIds: string[] }) => {
    const { group } = editDialogState;
    try {
      if (group) {
        await updateMutation.mutateAsync({ id: group.id, ...params });
        toast.success(t("skillGroups.updated", "分组已更新"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("skillGroups.created", "分组已创建"));
      }
      setEditDialogState({ open: false, group: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete.group) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.group.id);
      toast.success(t("skillGroups.deleted", "分组已删除"));
      setConfirmDelete({ open: false, group: null });
    } catch (error) {
      toast.error(t("common.error", "操作失败"), { description: String(error) });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("skillGroups.description", "将 Skill 按场景分组，在工作空间中一键绑定")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditDialogState({ open: true, group: null })}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("skillGroups.new", "新建分组")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t("skillGroups.empty", "还没有分组，点击「新建分组」开始")}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {groups.map((group) => (
                <SortableGroupItem
                  key={group.id}
                  group={group}
                  onEdit={() => setEditDialogState({ open: true, group })}
                  onDelete={() => setConfirmDelete({ open: true, group })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <SkillGroupEditDialog
        open={editDialogState.open}
        group={editDialogState.group}
        onClose={() => setEditDialogState({ open: false, group: null })}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={t("skillGroups.deleteTitle", "删除分组")}
        message={t(
          "skillGroups.deleteMessage",
          "确认删除「{{name}}」？分组内的 Skill 不会被卸载。",
          { name: confirmDelete.group?.name }
        )}
        confirmText={t("common.delete", "删除")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete({ open: false, group: null })}
      />
    </div>
  );
}
