export function structureGuardReason(ledgerDirty: boolean, categoriesDirty: boolean): string | null {
  if (ledgerDirty) return "请先保存或撤销账本更改";
  if (categoriesDirty) return "请先保存或撤销分类更改";
  return null;
}
