/**
 * Sentori Expo Config Plugin.
 *
 * `@goliapkg/sentori-react-native` already exposes
 * `expo-module.config.json` + iOS podspec + Android build.gradle, so
 * Expo Modules autolinking handles the native side without any
 * additional config-plugins work. The Config Plugin entry exists
 * mainly as a marker so users can drop:
 *
 *   {
 *     "expo": {
 *       "plugins": ["@goliapkg/sentori-expo"]
 *     }
 *   }
 *
 * into their app.json without breaking the build, and so we can
 * extend it later (e.g. SDK-version metadata in Info.plist /
 * AndroidManifest, native crash-handler opt-ins) without changing
 * the user-facing wiring.
 *
 * The plugin is intentionally CommonJS — Expo's plugin loader uses
 * `require()`.
 */
const { withInfoPlist } = require('@expo/config-plugins')

const SENTORI_VERSION_KEY = 'SentoriSdkVersion'

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{ sdkVersion?: string }} [props]
 */
const withSentori = (config, props = {}) => {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults[SENTORI_VERSION_KEY] = props.sdkVersion || '0.1.0'
    return cfg
  })
}

module.exports = withSentori
