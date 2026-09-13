"use server";

import { revalidatePath } from "next/cache";
import { canonServiceFetch, canonServiceErrorMessage } from "@/lib/canonService";

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export async function transitionEntryAction(
  entryId: string,
  newStatus: string,
): Promise<ActionResult<{ status: string }>> {
  const response = await canonServiceFetch(`/knowledge-core/entries/${entryId}/transition`, {
    method: "POST",
    body: JSON.stringify({ new_status: newStatus }),
  });

  if (!response.ok) {
    return { ok: false, error: await canonServiceErrorMessage(response) };
  }

  const body = await response.json();
  revalidatePath(`/admin/knowledge-core/${entryId}`);
  revalidatePath("/admin/knowledge-core");
  return { ok: true, status: body.status };
}

export async function commitExtractionAction(input: {
  sourceEntryId: string;
  targetType: string;
  extractedContent: Record<string, unknown>;
  clearanceLevel: number;
  bookPlacement: string;
}): Promise<ActionResult<{ operationalTable: string; operationalRowId: string }>> {
  const response = await canonServiceFetch("/knowledge-core/extractions", {
    method: "POST",
    body: JSON.stringify({
      source_entry_id: input.sourceEntryId,
      target_type: input.targetType,
      extracted_content: input.extractedContent,
      clearance_level: input.clearanceLevel,
      book_placement: input.bookPlacement,
    }),
  });

  if (!response.ok) {
    return { ok: false, error: await canonServiceErrorMessage(response) };
  }

  const body = await response.json();
  revalidatePath(`/admin/knowledge-core/${input.sourceEntryId}`);
  return { ok: true, operationalTable: body.operational_table, operationalRowId: body.operational_row_id };
}
