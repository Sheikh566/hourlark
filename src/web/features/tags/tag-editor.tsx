import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import { Button, Input, Modal, useToast } from "@/web/components/ui";
import { apiRequest } from "@/web/lib/api";
import type { Tag } from "@/web/types";

/**
 * New/Edit tag dialog. Toggl's is a 360px dialog with just the name field and a full-width action
 * button; the colour swatch is a Hourlark addition and sits beside the name field.
 */
export function TagEditor({
  open,
  tag,
  onOpenChange,
}: {
  open: boolean;
  tag: Tag | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const nameErrorId = useId();
  const formId = useId();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [color, setColor] = useState("#14852B");
  useEffect(() => {
    setName(tag?.name ?? "");
    setNameError(null);
    setColor(tag?.color ?? "#14852B");
  }, [open, tag]);
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(tag ? `/tags/${tag.id}` : "/tags", {
        method: tag ? "PATCH" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          color,
          ...(tag ? { version: tag.version } : {}),
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast({
        title: "Success",
        message: tag ? "Tag updated successfully" : "Tag created successfully",
      });
      onOpenChange(false);
    },
  });
  return (
    <Modal
      // Toggl's tag dialog: 360x187 with its 16px title. Compact's default title is 16/600.
      size="compact"
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
      title={tag ? "Edit Tag" : "New Tag"}
      footer={
        // Toggl's action fills the dialog width; it lives in the footer so it stays visible.
        <Button type="submit" form={formId} className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : tag ? "Save" : "Create"}
        </Button>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (mutation.isPending) return;
          if (!name.trim()) {
            setNameError("Enter a tag name.");
            return;
          }
          setNameError(null);
          mutation.mutate();
        }}
      >
        {/* Keeps Enter-to-submit working now the visible action lives in the (out-of-form) footer. */}
        <button type="submit" hidden />
        <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-1.5">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Tag name"
              placeholder="Tag name"
              className="bg-surface-hover placeholder:text-fg-subtle !border-[#2a2a2a]"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? nameErrorId : undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              type="color"
              aria-label="Tag color"
              className="bg-surface-hover w-9 shrink-0 cursor-pointer !border-[#2a2a2a] p-1"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </div>
          {nameError ? (
            <span id={nameErrorId} role="alert" className="text-xs font-medium text-[#e32817]">
              {nameError}
            </span>
          ) : null}
          {mutation.error ? (
            <p role="alert" className="text-sm text-[#e32817]">
              {mutation.error.message}
            </p>
          ) : null}
        </fieldset>
      </form>
    </Modal>
  );
}
