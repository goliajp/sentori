#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { reactNativeUpload } from './react-native.js';
import { uploadSourcemaps } from './upload.js';
const HELP = `sentori-cli — upload release artifacts to Sentori

Usage:
  sentori-cli upload sourcemap [options] <path...>
      Upload one or more files or directories. A directory is scanned
      (one level) for *.map / *.js / *.jsbundle / *.bundle / *.hbc;
      a file given explicitly is uploaded as-is. Use this for web
      bundlers (point at the build dir) or for already-composed RN maps.

  sentori-cli react-native upload [options]
      Compose a Metro packager map + a Hermes map into one source map
      and upload it (plus the bundle). Use this for a Hermes release
      build. Requires --metro-map and --hermes-map.

Options (both commands):
  --release <r>     release identifier — MUST equal the value the SDK
                    reports via init({ release }). Required. A mismatch
                    means the dashboard silently can't symbolicate.
  --token <t>       Sentori token (or set $SENTORI_TOKEN).
  --api-url <url>   Sentori API base (default https://api.sentori.golia.jp,
                    or $SENTORI_API_URL). For a self-hosted instance,
                    your host. (Accepts --ingest-url as an alias.)
  --dry-run         describe what would be uploaded; don't upload.
  -h, --help        show this help.

Options (react-native upload):
  --metro-map <p>   the *.packager.map Metro emits (--sourcemap-output).
  --hermes-map <p>  the *.hbc.map the Hermes compiler emits.
  --bundle <p>      optional: also upload the bundle (.jsbundle / .bundle).

Hermes release build, by hand:
  npx react-native bundle --platform ios --dev false --entry-file index.js \\
    --bundle-output main.jsbundle --sourcemap-output main.jsbundle.packager.map
  # (the iOS/Android build compiles to Hermes and writes main.jsbundle.hbc.map)
  npx @goliapkg/sentori-cli react-native upload \\
    --release "<app>@<version>+<build>" --token "$SENTORI_TOKEN" \\
    --metro-map main.jsbundle.packager.map --hermes-map main.jsbundle.hbc.map \\
    --bundle main.jsbundle
`;
/** Parse the shared options, or print an error + return null. */
function parseCommon(values) {
    const release = typeof values.release === 'string' ? values.release : undefined;
    if (!release) {
        console.error('error: --release is required (must match the SDK’s init({ release }))');
        return null;
    }
    const dryRun = values['dry-run'] === true;
    const token = (typeof values.token === 'string' ? values.token : undefined) ?? process.env.SENTORI_TOKEN;
    if (!token && !dryRun) {
        console.error('error: --token (or $SENTORI_TOKEN) is required');
        return null;
    }
    const apiUrl = (typeof values['api-url'] === 'string' ? values['api-url'] : undefined) ??
        (typeof values['ingest-url'] === 'string' ? values['ingest-url'] : undefined) ??
        process.env.SENTORI_API_URL ??
        'https://api.sentori.golia.jp';
    return { apiUrl, dryRun, release, token: token ?? '' };
}
async function cmdUploadSourcemap(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            allowPositionals: true,
            args: argv,
            options: {
                'api-url': { type: 'string' },
                'dry-run': { type: 'boolean' },
                help: { short: 'h', type: 'boolean' },
                'ingest-url': { type: 'string' },
                release: { type: 'string' },
                token: { type: 'string' },
            },
        });
    }
    catch (e) {
        console.error(`error: ${e.message}\n`);
        console.error(HELP);
        return 2;
    }
    if (parsed.values.help) {
        console.log(HELP);
        return 0;
    }
    const c = parseCommon(parsed.values);
    if (!c)
        return 2;
    if (parsed.positionals.length === 0) {
        console.error('error: at least one path (file or directory) is required');
        return 2;
    }
    try {
        const result = await uploadSourcemaps({
            apiUrl: c.apiUrl,
            dryRun: c.dryRun,
            paths: parsed.positionals,
            release: c.release,
            token: c.token,
        });
        reportUpload(result, c);
        return 0;
    }
    catch (e) {
        console.error(`upload failed: ${e.message}`);
        return 1;
    }
}
async function cmdReactNativeUpload(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            options: {
                'api-url': { type: 'string' },
                bundle: { type: 'string' },
                'dry-run': { type: 'boolean' },
                help: { short: 'h', type: 'boolean' },
                'hermes-map': { type: 'string' },
                'ingest-url': { type: 'string' },
                'metro-map': { type: 'string' },
                release: { type: 'string' },
                token: { type: 'string' },
            },
        });
    }
    catch (e) {
        console.error(`error: ${e.message}\n`);
        console.error(HELP);
        return 2;
    }
    if (parsed.values.help) {
        console.log(HELP);
        return 0;
    }
    const c = parseCommon(parsed.values);
    if (!c)
        return 2;
    const metroMap = parsed.values['metro-map'];
    const hermesMap = parsed.values['hermes-map'];
    if (typeof metroMap !== 'string' || typeof hermesMap !== 'string') {
        console.error('error: --metro-map and --hermes-map are both required');
        return 2;
    }
    try {
        const result = await reactNativeUpload({
            apiUrl: c.apiUrl,
            bundle: typeof parsed.values.bundle === 'string' ? parsed.values.bundle : undefined,
            dryRun: c.dryRun,
            hermesMap,
            metroMap,
            release: c.release,
            token: c.token,
        });
        reportUpload(result, c);
        return 0;
    }
    catch (e) {
        console.error(`react-native upload failed: ${e.message}`);
        return 1;
    }
}
function reportUpload(result, c) {
    if (c.dryRun) {
        console.log(`would upload ${result.files.length} file(s) to ${c.apiUrl.replace(/\/+$/, '')}/admin/api/releases/${encodeURIComponent(c.release)}/sourcemaps:`);
        for (const f of result.files)
            console.log(`  ${f}`);
    }
    else {
        console.log(`uploaded ${result.uploaded ?? result.files.length} file(s) for release "${c.release}" — minified stacks on this release will now resolve to source.`);
    }
}
async function main(argv) {
    if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
        console.log(HELP);
        return 0;
    }
    const [a, b, ...rest] = argv;
    if (a === 'upload' && b === 'sourcemap')
        return cmdUploadSourcemap(rest);
    if (a === 'react-native' && b === 'upload')
        return cmdReactNativeUpload(rest);
    console.error(`unknown command: ${[a, b].filter(Boolean).join(' ') || '(none)'}\n`);
    console.error(HELP);
    return 2;
}
main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`fatal: ${e.message}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map