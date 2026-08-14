"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { deleteProject } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

function ConfirmSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? "Deleting..." : "Confirm"}
    </Button>
  );
}

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    );
  }

  return (
    <form action={deleteProject} className="flex items-center gap-2">
      <input type="hidden" name="id" value={projectId} />
      <span className="text-sm text-muted-foreground">Delete this project?</span>
      <ConfirmSubmit />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
    </form>
  );
}
