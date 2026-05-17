// Metro config for monorepo: example/ depends on the parent SDK
// (`@goliapkg/sentori-react-native` via `file:..`), and bun's isolated
// install puts the package.json as a symlink. Metro doesn't follow
// symlinks by default and only watches the project root, so we need
// to explicitly opt in and add the parent SDK as a watched root.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sdkRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(sdkRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// Pin Metro to 9090 so 8081 stays free for whatever else the dev
// box is running. The iOS native build bakes the dev-server URL
// from RCT_METRO_PORT at compile time (set in ios/.xcode.env.local),
// so changing this number requires a clean rebuild of the .app.
config.server = {
  ...(config.server ?? {}),
  port: 9090,
};

module.exports = config;
