// V8 / Node / Bun: "at fn (file:line:col)" or "at file:line:col" or "at fn file:line:col"
// File can be a URL (https://…), so we anchor on the trailing `:\d+:\d+\)?$`
// and let `(?<file>.+?)` swallow whatever comes before.
const V8_RE = /^\s*at\s+(?:(?<fn>.+?)\s+)?\(?(?<file>.+?):(?<line>\d+):(?<col>\d+)\)?\s*$/;
// SpiderMonkey / Safari: "fn@file:line:col" — same trailing anchor.
const SPIDER_RE = /^(?:(?<fn>[^@]*)@)?(?<file>.+?):(?<line>\d+):(?<col>\d+)\s*$/;
/** Best-effort parse of an `Error.stack` string into Sentori frames. */
export function parseStack(stack) {
    if (!stack)
        return [];
    const lines = stack.split('\n');
    const out = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line)
            continue;
        const m = V8_RE.exec(line) ?? SPIDER_RE.exec(line);
        if (!m?.groups)
            continue;
        const file = m.groups.file ?? '<anonymous>';
        out.push({
            absolutePath: file,
            column: Number(m.groups.col),
            file: shortFile(file),
            function: m.groups.fn?.trim(),
            inApp: !file.includes('node_modules') && !file.startsWith('node:'),
            line: Number(m.groups.line),
        });
    }
    return out;
}
function shortFile(absolute) {
    // Strip protocol + leading path noise so the dashboard shows
    // e.g. "App.tsx" instead of "https://example.com/static/App.tsx".
    const noProto = absolute.replace(/^https?:\/\/[^/]+\//, '');
    const tail = noProto.split('/').slice(-2).join('/');
    return tail || absolute;
}
//# sourceMappingURL=stack.js.map