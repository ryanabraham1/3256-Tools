"use client";

import { deletePart } from "@/app/parts-actions";
import type { FabPart } from "@/lib/parts";
import { ErrorText, useFabAction } from "./fab-ui";
import { Sheet } from "./sheet";

export function DeletePartSheet({
  part,
  onClose,
  onDeleted,
}: {
  part: Pick<FabPart, "id" | "name" | "onshape_key">;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const removal = useFabAction(
    (fd) => deletePart(fd).catch(() => ({ ok: false, error: "Couldn't delete the part. Check your connection and try again." })),
    () => {
      onDeleted();
      onClose();
    },
  );

  function cancel() {
    if (!removal.pending) onClose();
  }

  return (
    <Sheet open onClose={cancel} title="Delete part?">
      <div className="flex flex-col gap-3">
        <p className="text-sm break-words">
          This permanently deletes <strong>{part.name}</strong> and its attached files and history.
        </p>
        {part.onshape_key && <p className="text-sm">A future Onshape sync can add this part again.</p>}
        <ErrorText error={removal.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" disabled={removal.pending} onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" disabled={removal.pending} onClick={() => removal.call({ id: part.id })}>
            {removal.pending ? "Deleting…" : "Delete part"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
