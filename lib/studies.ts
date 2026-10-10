import "server-only";
import { initialStudy } from "@/lib/default-study";
import { getAdminClient } from "@/lib/supabase";
import type { SavedStudy, StudyDefinition } from "@/lib/types";

const now = new Date().toISOString();
let memoryStudies: SavedStudy[] = [{
  id: "00000000-0000-4000-8000-000000000001",
  name: initialStudy.name,
  definition: structuredClone(initialStudy),
  revision: 1,
  createdAt: now,
  updatedAt: now,
}];

function mapStudy(row: Record<string, unknown>): SavedStudy {
  return {
    id: String(row.id),
    name: String(row.name),
    definition: row.definition as StudyDefinition,
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listStudies() {
  const client = getAdminClient();
  if (!client) return memoryStudies;
  const { data, error } = await client.from("fastevent_studies")
    .select("id,name,definition,revision,created_at,updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapStudy(row));
}

export async function getStudy(id: string) {
  const client = getAdminClient();
  if (!client) return memoryStudies.find((item) => item.id === id) ?? null;
  const { data, error } = await client.from("fastevent_studies")
    .select("id,name,definition,revision,created_at,updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapStudy(data) : null;
}

export async function createStudy(definition: StudyDefinition) {
  const client = getAdminClient();
  const timestamp = new Date().toISOString();
  if (!client) {
    const study: SavedStudy = {
      id: crypto.randomUUID(), name: definition.name, definition, revision: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    memoryStudies = [study, ...memoryStudies.filter((item) => item.name.toLowerCase() !== definition.name.toLowerCase())];
    return study;
  }
  const { data, error } = await client.from("fastevent_studies").insert({
    name: definition.name,
    definition,
  }).select("id,name,definition,revision,created_at,updated_at").single();
  if (error) throw error;
  return mapStudy(data);
}

export async function updateStudy(id: string, definition: StudyDefinition, revision: number) {
  const client = getAdminClient();
  if (!client) {
    const index = memoryStudies.findIndex((item) => item.id === id && item.revision === revision);
    if (index < 0) return null;
    memoryStudies[index] = { ...memoryStudies[index], name: definition.name, definition, revision: revision + 1, updatedAt: new Date().toISOString() };
    return memoryStudies[index];
  }
  const { data, error } = await client.from("fastevent_studies")
    .update({ name: definition.name, definition, revision: revision + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("revision", revision)
    .is("deleted_at", null)
    .select("id,name,definition,revision,created_at,updated_at")
    .maybeSingle();
  if (error) throw error;
  return data ? mapStudy(data) : null;
}

export async function deleteStudy(id: string, revision: number) {
  const client = getAdminClient();
  if (!client) {
    const before = memoryStudies.length;
    memoryStudies = memoryStudies.filter((item) => !(item.id === id && item.revision === revision));
    return memoryStudies.length < before;
  }
  const { data, error } = await client.from("fastevent_studies")
    .update({ deleted_at: new Date().toISOString(), revision: revision + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("revision", revision)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
