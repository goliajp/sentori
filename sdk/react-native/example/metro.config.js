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

module.exports = config;
