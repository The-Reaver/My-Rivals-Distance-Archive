import { createClient } from "@/lib/supabase/server";
import { ChronicleEditor } from "@/components/ChronicleEditor";

export default async function NewChroniclePage() {
  const supabase = await createClient();
  const { data: characters } = await supabase
    .from("characters")
    .select("id, name")
    .order("name");

  return (
    <div>
      <h1 className="font-display text-section-heading text-text-primary">New Chronicle Entry</h1>
      <div className="mt-lg">
        <ChronicleEditor mode="create" characters={characters ?? []} />
      </div>
    </div>
  );
}
