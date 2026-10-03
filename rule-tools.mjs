// Pure helpers shared by conversion and its regression tests.
export const titleKey = value => String(value || '').normalize('NFKC')
  .replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

export function collapseTitleAliases(mappings) {
  const resolved = new Map();
  for (const [source, target] of mappings) {
    let current = target;
    const seen = new Set([source]);
    while (mappings.has(current) && !seen.has(current)) {
      seen.add(current);
      current = mappings.get(current);
    }
    // Cycles do not establish a canonical identity; preserve the original.
    resolved.set(source, seen.has(current) ? target : current);
  }
  for (const [source, target] of resolved) mappings.set(source, target);
}

export function parseRuntimeRule(line) {
  const match = String(line).trim().match(/^(.+?)\s+S(\d+)E(\d+)(?:~E?(\d+))?(?:\s+\{\[group=([^\]}]+)\]\})?\s*->\s*(.+?)\s+S(\d+)E(\d+)(?:~E?(\d+))?(?:\s+@([\w-]+))?$/i);
  if (!match) return null;
  const [, sourceTitle, season, start, end, group, targetTitle, targetSeason, targetStart, targetEnd, platform] = match;
  const rule = { sourceTitle, season: +season, start: +start, end: end === undefined ? null : +end,
    group: group || '', targetTitle, targetSeason: +targetSeason, targetStart: +targetStart,
    targetEnd: targetEnd === undefined ? null : +targetEnd,
    platform: ({ qq: 'tencent', qiyi: 'iqiyi', bilibili1: 'bilibili' })[platform?.toLowerCase()] || platform?.toLowerCase() || '' };
  if (rule.season < 1 || rule.start < 1 || rule.targetSeason < 1 || rule.targetStart < 1) return null;
  if ((rule.end === null) !== (rule.targetEnd === null)) return null;
  if (rule.end !== null && (rule.end < rule.start || rule.targetEnd < rule.targetStart
      || rule.end - rule.start !== rule.targetEnd - rule.targetStart)) return null;
  return rule;
}

function formatRule(rule) {
  return `${rule.sourceTitle} S${rule.season}E${rule.start}${rule.end === null ? '' : `~E${rule.end}`}`
    + `${rule.group ? ` {[group=${rule.group}]}` : ''} -> ${rule.targetTitle} S${rule.targetSeason}E${rule.targetStart}`
    + `${rule.targetEnd === null ? '' : `~E${rule.targetEnd}`}${rule.platform ? ` @${rule.platform}` : ''}`;
}

export function expandRuleAliases(lines, mappings) {
  const families = new Map();
  for (const [source, target] of mappings) {
    // A season/year-qualified alias must never become an all-season identity.
    if (/S\d+|(?:19|20)\d{2}/i.test(source) || /S\d+|(?:19|20)\d{2}/i.test(target)) continue;
    const key = titleKey(target);
    if (!families.has(key)) families.set(key, new Set([target]));
    families.get(key).add(source);
  }
  const result = new Set(lines);
  for (const line of lines) {
    const rule = parseRuntimeRule(line);
    if (!rule) continue;
    let family = families.get(titleKey(rule.sourceTitle));
    if (!family) {
      // Rules may use an English member of a Chinese-title family.
      const matches = [...families.values()].filter(items => [...items].some(item => titleKey(item) === titleKey(rule.sourceTitle)));
      if (matches.length === 1) family = matches[0];
    }
    for (const alias of family || []) result.add(formatRule({ ...rule, sourceTitle: alias }));
  }
  return [...result];
}

export function findRuleConflicts(lines) {
  const parsed = lines.map(line => ({ line, rule: parseRuntimeRule(line) })).filter(item => item.rule);
  const conflicts = [];
  for (let i = 0; i < parsed.length; i++) {
    const a = parsed[i].rule;
    for (let j = i + 1; j < parsed.length; j++) {
      const b = parsed[j].rule;
      const aGroups = a.group.split(/[|,;]/).map(titleKey).filter(Boolean);
      const bGroups = b.group.split(/[|,;]/).map(titleKey).filter(Boolean);
      const groupsOverlap = aGroups.length && bGroups.length
        ? aGroups.some(group => bGroups.includes(group)) : !aGroups.length && !bGroups.length;
      if (titleKey(a.sourceTitle) !== titleKey(b.sourceTitle) || a.season !== b.season
          || !groupsOverlap || a.platform !== b.platform) continue;
      const overlap = Math.max(a.start, b.start) <= Math.min(a.end ?? Infinity, b.end ?? Infinity);
      if (!overlap) continue;
      // Open transition points and bounded overrides are intentionally supported.
      if (a.end === null && b.end === null && a.start !== b.start) continue;
      if ((a.end === null) !== (b.end === null)) continue;
      if (titleKey(a.targetTitle) === titleKey(b.targetTitle) && a.targetSeason === b.targetSeason
          && a.targetStart - a.start === b.targetStart - b.start) continue;
      conflicts.push({ first: parsed[i].line, second: parsed[j].line, reason: '相同条件下的集数区间重叠，但目标或偏移不同' });
    }
  }
  return conflicts;
}

function numericRanges(expression) {
  // Deliberately small grammar: digit alternatives/classes, no arbitrary regex execution.
  if (expression.length > 80 || !/^[0-9()\[\]|-]+$/.test(expression)) return [];
  let regex;
  try { regex = new RegExp(`^(?:${expression})$`); } catch { return []; }
  const values = [];
  for (let n = 1; n <= 999; n++) if (regex.test(String(n))) values.push(n);
  const ranges = [];
  for (const n of values) {
    const last = ranges.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges;
}

// These are review proposals, NEVER runtime rules. MP numbering is not evidence
// that a particular danmaku platform uses the same numbering or season catalogue.
export function proposeMoviePilotRule(raw) {
  const arrow = raw.indexOf('=>');
  if (arrow < 0) return [];
  const left = raw.slice(0, arrow).trim();
  const right = raw.slice(arrow + 2).trim();
  const offset = Number(right.match(/>>\s*EP([+-]\d+)/i)?.[1] || 0);
  const target = right.split(/\s*(?:&&|<>|>>)/)[0].replace(/\{\[[^\]]*\]\}/g, '').trim();
  const src = left.match(/^(.*?)[\s._-]+S(\d{1,2})(?:E)?/i);
  const dst = target.match(/^(.+?)[\s._-]+S(\d{1,2})(?:E(?:\\\d|\d*))?(?:[\s._-]+(?:19|20)\d{2})?$/i);
  if (!src || !dst) return [];
  let sourceTitle = src[1].replace(/[\s._-]+(?:19|20)\d{2}$/, '');
  // Keep the original regex/conditions in the report even when a literal
  // title can be proposed from an optional Chinese-name prefix.
  sourceTitle = sourceTitle.replace(/^\(\?:[^()]+\)\?/, '').replace(/\\\./g, '.');
  if (/[\\()[\]{}?*+|^$]/.test(sourceTitle)) return [];
  let targetTitle = dst[1].replace(/[\s._-]+(?:19|20)\d{2}$/, '');
  if (/[\\()[\]{}?*+|^$]/.test(targetTitle)) return [];
  const rangeExpr = left.match(/E\(([^()]+)\)/)?.[1];
  const ranges = rangeExpr ? numericRanges(rangeExpr) : [];
  // Do not guess an upper boundary for a season-only rule.
  if (!ranges.length) ranges.push([Math.max(1, 1 - offset), null]);
  const groups = [...new Set([...left.matchAll(/\b([A-Za-z][\w-]*(?:WEB|Web)|ANi|LoliHouse)\b/g)].map(item => item[1]))];
  return ranges.filter(([start]) => start + offset > 0).flatMap(([start, end]) =>
    (groups.length ? groups : ['']).map(group => ({
      suggestedRule: formatRule({ sourceTitle, season: +src[2], start, end, group,
        targetTitle, targetSeason: +dst[2], targetStart: start + offset,
        targetEnd: end === null ? null : end + offset, platform: '' }),
      bounded: end !== null,
      conditions: left,
      modifiers: right.slice(target.length),
      status: 'needs-platform-verification'
    })));
}
