// ─── PR number extraction ─────────────────────────────────────────────────────

export function extractPRNumber(subject: string, body: string): string | null {
  const combined = `${subject} ${body}`;
  const m = combined.match(/(?:pull\s+request\s+#|pr\s*#|\(#|(?:^|\s)#)(\d+)/i);
  return m ? m[1] : null;
}
