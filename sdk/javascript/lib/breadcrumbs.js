const MAX = 100;
const buf = [];
export function addBreadcrumb(input) {
    const crumb = {
        data: input.data ?? {},
        timestamp: new Date().toISOString(),
        type: input.type,
    };
    buf.push(crumb);
    if (buf.length > MAX)
        buf.shift();
}
export function getBreadcrumbs() {
    return [...buf];
}
export function clearBreadcrumbs() {
    buf.length = 0;
}
//# sourceMappingURL=breadcrumbs.js.map