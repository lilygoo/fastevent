import { isDeepStrictEqual } from "node:util";
import { initialStudy } from "../lib/default-study";
import { getAdminClient } from "../lib/supabase";
import { studyDefinitionSchema } from "../lib/validation";

async function main() {
  const definition = studyDefinitionSchema.parse(initialStudy);
  const client = getAdminClient();
  if (!client) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  const { data: existing, error: lookupError } = await client.from("fastevent_studies")
    .select("id,revision,name,definition")
    .ilike("name", definition.name)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    if (existing.name === definition.name && isDeepStrictEqual(existing.definition, definition)) {
      process.stdout.write(`Already current: ${definition.name}.\n`);
      return;
    }
    const { error } = await client.from("fastevent_studies").update({
      name: definition.name,
      definition,
      updated_at: new Date().toISOString(),
      revision: Number(existing.revision) + 1,
    }).eq("id", existing.id);
    if (error) throw error;
    process.stdout.write(`Updated ${definition.name}.\n`);
    return;
  }
  const { error } = await client.from("fastevent_studies").insert({ name: definition.name, definition });
  if (error) throw error;
  process.stdout.write(`Created ${definition.name}.\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null
      ? JSON.stringify(error, null, 2)
      : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
