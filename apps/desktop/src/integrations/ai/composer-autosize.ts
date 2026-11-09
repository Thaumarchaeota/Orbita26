export type ComposerTextareaStyleArgs = {
  expanded: boolean;
  scrollHeight: number;
  lineHeight: number;
  minHeight: number;
  maxLines: number;
  paddingTop: number;
  paddingBottom: number;
};

export function composerTextareaStyle(
  args: ComposerTextareaStyleArgs,
): { height: string; overflowY: "auto" | "hidden" } {
  const maxHeight = Math.round(
    args.lineHeight * args.maxLines + args.paddingTop + args.paddingBottom,
  );
  if (!args.expanded) {
    return { height: `${args.minHeight}px`, overflowY: "hidden" };
  }
  const contentHeight = Math.max(args.minHeight, args.scrollHeight);
  if (contentHeight > maxHeight) {
    return { height: `${maxHeight}px`, overflowY: "auto" };
  }
  return { height: `${contentHeight}px`, overflowY: "hidden" };
}
