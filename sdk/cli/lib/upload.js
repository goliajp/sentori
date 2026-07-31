// Unified symbolication-artifact upload: sourcemap / dsym / proguard
// all land on `POST /v1/releases/{release}/artifacts` (multipart
// `kind` + `file`), authenticated with an api-scope token. A late
// upload triggers retro-symbolication server-side, which is what
// makes the lenient exit-0 contract honest — nothing is lost
// forever.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
export async function uploadArtifact(opts) {
    const bytes = readFileSync(opts.path);
    if (bytes.length === 0)
        throw new Error(`empty file: ${opts.path}`);
    const form = new FormData();
    form.append('kind', opts.kind);
    form.append('file', new Blob([new Uint8Array(bytes)]), opts.name ?? basename(opts.path));
    const url = `${opts.apiUrl.replace(/\/+$/, '')}/v1/releases/${encodeURIComponent(opts.release)}/artifacts`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.token}` },
        body: form,
    });
    if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(`${resp.status} ${resp.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    return (await resp.json());
}
//# sourceMappingURL=upload.js.map