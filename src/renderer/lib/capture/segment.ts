// Split a free-text capture into ordered activity segments.
//
// Newlines first (each line is its own group), then within a line on
// connectors: comma, semicolon, arrows, and the word "then". We do NOT
// split on dashes — those separate the two ends of a time range and must
// stay inside their segment.
//
// Sequence words ("then", "after that", …) are treated as separators, not
// description text. "and then" / "after that" are matched before the
// shorter "then" so the whole phrase is consumed.
//
// Known v1 limitation: a comma inside a note ("emails, slack, standup")
// over-splits into three segments. The review UI is the safety net.
const CONNECTOR =
  /\s*(?:,|;|→|->|\band then\b|\bafter that\b|\bafterwards\b|\bthen\b)\s*/gi;

export function segmentText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const piece of line.split(CONNECTOR)) {
      const t = piece.trim();
      if (t) out.push(t);
    }
  }
  return out;
}
