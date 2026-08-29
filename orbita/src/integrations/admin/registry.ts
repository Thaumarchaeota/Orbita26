import type { InsightDestination, InsightDestinationId } from "./types";

const destinations: InsightDestination[] = [];

export function registerInsightDestination(dest: InsightDestination): void {
  if (destinations.some((d) => d.id === dest.id)) {
    throw new Error(`insight destination already registered: ${dest.id}`);
  }
  destinations.push(dest);
}

export function getInsightDestinations(): readonly InsightDestination[] {
  return destinations;
}

export function getInsightDestination(id: InsightDestinationId): InsightDestination | undefined {
  return destinations.find((d) => d.id === id);
}
