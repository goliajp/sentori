#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { uploadSourcemaps } from './upload.js';
const HELP = `sentori-cli — upload release artifacts to Sentori

Usage:
  sentori-cli upload sourcemap [options] <path...>

  <path>   one or more files or directories. A directory is scanned
           (one level) for *.map and *.js / *.bundle / *.hbc files.
           A file given explicitly is uploaded as-is.

Options:
  --release <r>     release identifier — MUST equal the value the SDK
                    reports via init({ release }). Required. A mismatch
                    means the dashboard silently can't symbolicate.
  --token <t>       Sentori token (or set $SENTORI_TOKEN).
  --api-url <url>   Sentori API base (default https://api.sentori.golia.jp,
                    or $SENTORI_API_URL). For a self-hosted instance, your
                    host. (Accepts --ingest-url as an alias.)
  --dry-run         list what would be uploaded; don't upload.
  -h, --help        show this help.

React Native / Hermes: in a release build the *minified* map (Metro)
and the *bytecode* map (Hermes) must be composed first —
  npx react-native bundle --platform ios --dev false \\
    --entry-file index.js --bundle-output main.jsbundle \\
    --sourcemap-output main.jsbundle.packager.map
  node node_modules/react-native/scripts/compose-source-maps.js \\
    main.jsbundle.packager.map main.jsbundle.hbc.map -o main.jsbundle.map
then \`sentori-cli upload sourcemap --release "<app>@<version>+<build>" main.jsbundle.map main.jsbundle\`.
(Web bundlers emit a usable .map directly — just point at the build dir.)
`;
async function main(argv) {
    if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
        console.log(HELP);
        return 0;
    }
    if (argv[0] !== 'upload' || argv[1] !== 'sourcemap') {
        console.error(`unknown command: ${argv.slice(0, 2).join(' ') || '(none)'}\n`);
        console.error(HELP);
        return 2;
    }
    let parsed;
    try {
        parsed = parseArgs({
            allowPositionals: true,
            args: argv.slice(2),
            options: {
                'api-url': { type: 'string' },
                'dry-run': { type: 'boolean' },
                help: { short: 'h', type: 'boolean' },
                'ingest-url': { type: 'string' }, // alias, kept for older docs
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
    const { positionals, values } = parsed;
    if (values.help) {
        console.log(HELP);
        return 0;
    }
    const release = values.release;
    if (!release) {
        console.error('error: --release is required (must match the SDK’s init({ release }))');
        return 2;
    }
    const dryRun = !!values['dry-run'];
    const token = values.token ?? process.env.SENTORI_TOKEN;
    if (!token && !dryRun) {
        console.error('error: --token (or $SENTORI_TOKEN) is required');
        return 2;
    }
    const apiUrl = values['api-url'] ??
        values['ingest-url'] ??
        process.env.SENTORI_API_URL ??
        'https://api.sentori.golia.jp';
    if (positionals.length === 0) {
        console.error('error: at least one path (file or directory) is required');
        return 2;
    }
    try {
        const result = await uploadSourcemaps({
            apiUrl,
            dryRun,
            paths: positionals,
            release,
            token: token ?? '',
        });
        if (dryRun) {
            console.log(`would upload ${result.files.length} file(s) to ${apiUrl.replace(/\/+$/, '')}/admin/api/releases/${encodeURIComponent(release)}/sourcemaps:`);
            for (const f of result.files)
                console.log(`  ${f}`);
        }
        else {
            console.log(`uploaded ${result.uploaded} file(s) for release "${release}"`);
            for (const a of result.artifacts ?? [])
                console.log(`  ${a.name}  [${a.kind}]`);
            console.log('done — minified stack traces on this release will now resolve to source.');
        }
        return 0;
    }
    catch (e) {
        console.error(`upload failed: ${e.message}`);
        return 1;
    }
}
main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`fatal: ${e.message}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map