/**
 * Local service catalog metadata. Service ids are derived from project groups
 * or account ids by the aggregator; this store only adds non-secret annotations.
 */

import { DataStore } from "./data-store.js";
import type { ServiceMetadata, ServiceMetadataInput, ServiceTier } from "./types.js";

interface ServiceMetadataFile {
  version: 1;
  services: ServiceMetadata[];
}

const TIERS: ServiceTier[] = ["critical", "standard", "internal", "experimental"];
const store = new DataStore<ServiceMetadataFile>("service-metadata.json", { version: 1, services: [] });

function clean(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function cleanUrl(value: string | undefined, field: string): string | undefined {
  const url = clean(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${field} must be an http(s) URL.`);
  }
}

function normalize(input: ServiceMetadataInput): ServiceMetadata {
  const serviceId = clean(input.serviceId);
  if (!serviceId) throw new Error("Service id is required.");
  const dependencies = Array.isArray(input.dependencies)
    ? [...new Set(input.dependencies.map((dependency) => dependency.trim()).filter(Boolean))].slice(0, 20)
    : undefined;
  return {
    serviceId,
    owner: clean(input.owner),
    tier: input.tier && TIERS.includes(input.tier) ? input.tier : undefined,
    runbookUrl: cleanUrl(input.runbookUrl, "Runbook URL"),
    dashboardUrl: cleanUrl(input.dashboardUrl, "Dashboard URL"),
    repositoryUrl: cleanUrl(input.repositoryUrl, "Repository URL"),
    dependencies: dependencies && dependencies.length > 0 ? dependencies : undefined,
    notes: clean(input.notes),
    updatedAt: new Date().toISOString(),
  };
}

export async function listServiceMetadata(): Promise<ServiceMetadata[]> {
  return (await store.load()).services;
}

export async function saveServiceMetadata(input: ServiceMetadataInput): Promise<ServiceMetadata> {
  const file = await store.load();
  const services = [...file.services];
  const index = services.findIndex((service) => service.serviceId === input.serviceId);
  const metadata = normalize(input);
  if (index >= 0) services[index] = metadata;
  else services.push(metadata);
  await store.save({ version: 1, services });
  return metadata;
}

export async function deleteServiceMetadata(serviceId: string): Promise<void> {
  const id = clean(serviceId);
  if (!id) throw new Error("Service id is required.");
  const file = await store.load();
  await store.save({ version: 1, services: file.services.filter((service) => service.serviceId !== id) });
}
