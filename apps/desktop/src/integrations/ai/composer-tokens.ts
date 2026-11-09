export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function contextWindowForModel(model: string): number {
  const lower = model.toLowerCase();
  if (lower.includes("32k")) return 32000;
  if (lower.includes("64k")) return 64000;
  if (lower.includes("128k")) return 128000;
  if (lower.includes("gpt-4o") || lower.includes("claude") || lower.includes("deepseek")) {
    return 128000;
  }
  return 128000;
}
