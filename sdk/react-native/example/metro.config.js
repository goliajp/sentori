// Metro config for the SDK example app.
//
// Why this isn't the Expo default:
//   1. `@goliapkg/sentori-react-native` is linked from `file:..` (the
//      parent SDK directory). Metro doesn't follow symlinks and only
//      watches the project root by default, so we explicitly add the
//      SDK as a watch root + enable unstable_enableSymlinks.
//   2. The dev box runs other RN apps on port 8081, so we pin Metro
//      to 9090. The iOS .app reads `RCT_METRO_PORT` from
//      `ios/.xcode.env.local` at build time and bakes the URL in.
//      Both numbers must match.

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

config.server = {
  ...(config.server ?? {}),
  port: 9090,
};

module.exports = config;
