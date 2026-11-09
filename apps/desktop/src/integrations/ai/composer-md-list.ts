type ListLine =
  | { kind: "unordered"; indent: string; marker: string; content: string }
  | { kind: "ordered"; indent: string; num: number; punct: string; content: string };

function lineAt(value: string, cursor: number): { start: number; end: number; text: string } {
  const start = value.lastIndexOf("\n", cursor - 1) + 1;
  const nextBreak = value.indexOf("\n", cursor);
  const end = nextBreak === -1 ? value.length : nextBreak;
  return { start, end, text: value.slice(start, end) };
}

function parseListLine(line: string): ListLine | null {
  const ul = line.match(/^(\s*)([-*+])\s(.*)$/);
  if (ul) {
    return { kind: "unordered", indent: ul[1], marker: ul[2], content: ul[3] };
  }
  const ol = line.match(/^(\s*)(\d+)([.)])\s(.*)$/);
  if (ol) {
    return {
      kind: "ordered",
      indent: ol[1],
      num: parseInt(ol[2], 10),
      punct: ol[3],
      content: ol[4],
    };
  }
  return null;
}

function listPrefix(parsed: ListLine, nextNum?: number): string {
  if (parsed.kind === "unordered") {
    return `${parsed.indent}${parsed.marker} `;
  }
  const num = nextNum ?? parsed.num + 1;
  return `${parsed.indent}${num}${parsed.punct} `;
}

export function continueMarkdownList(
  value: string,
  cursor: number,
): { kind: "continue" | "break" | "none"; next?: string; cursor?: number } {
  const { start, end, text } = lineAt(value, cursor);
  const parsed = parseListLine(text);
  if (!parsed) return { kind: "none" };

  if (parsed.content === "") {
    const next = value.slice(0, start) + value.slice(end);
    const nextCursor = start;
    return { kind: "break", next, cursor: nextCursor };
  }

  const prefix = `\n${listPrefix(parsed)}`;
  const next = value.slice(0, cursor) + prefix + value.slice(cursor);
  return { kind: "continue", next, cursor: cursor + prefix.length };
}

export function handleInsightComposerKeydown(opts: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
  value: string;
  cursor: number;
}): {
  preventDefault: boolean;
  submit?: boolean;
  value?: string;
  cursor?: number;
} {
  if (opts.key !== "Enter") return { preventDefault: false };
  if (opts.isComposing || opts.keyCode === 229) return { preventDefault: false };

  const newline = opts.shiftKey;
  const list = continueMarkdownList(opts.value, opts.cursor);

  if (newline) {
    if (list.kind === "continue") {
      return { preventDefault: true, value: list.next, cursor: list.cursor };
    }
    const next = opts.value.slice(0, opts.cursor) + "\n" + opts.value.slice(opts.cursor);
    return { preventDefault: true, value: next, cursor: opts.cursor + 1 };
  }

  if (list.kind === "continue" || list.kind === "break") {
    return { preventDefault: true, value: list.next, cursor: list.cursor };
  }

  return { preventDefault: true, submit: true };
}
