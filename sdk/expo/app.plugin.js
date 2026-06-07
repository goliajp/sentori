/**
 * Sentori Expo Config Plugin.
 *
 * `@goliapkg/sentori-react-native` already exposes
 * `expo-module.config.json` + iOS podspec + Android build.gradle, so
 * Expo Modules autolinking handles the native side without any
 * additional config-plugins work for error / span / replay capture.
 *
 * v2.11 — extends the plugin to also wire **push notifications** for
 * apps that opt in. When the host adds `@goliapkg/sentori-expo` to
 * its `app.json` plugins array, prebuild auto-injects:
 *
 *   iOS:
 *     - Info.plist: UIBackgroundModes ⊇ [remote-notification]
 *     - Entitlements: aps-environment = 'production' (Xcode flips to
 *       'development' for debug signing automatically)
 *
 *   Android:
 *     - AndroidManifest.xml: <uses-permission POST_NOTIFICATIONS>
 *     - Root build.gradle: classpath com.google.gms:google-services
 *     - App build.gradle: apply google-services + firebase-bom +
 *       firebase-messaging
 *     - Copies google-services.json from `props.googleServicesFile`
 *       (defaults to `./google-services.json` at the host root) to
 *       `android/app/google-services.json` on prebuild.
 *
 * Opt out per platform with `{ ios: false }` / `{ android: false }`.
 * Opt out entirely by not including the plugin in `app.json`.
 *
 * The plugin is intentionally CommonJS — Expo's plugin loader uses
 * `require()`.
 */
const fs = require('fs')
const path = require('path')
const {
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
  withProjectBuildGradle,
  withAppBuildGradle,
  withDangerousMod,
  AndroidConfig,
  withPlugins,
} = require('@expo/config-plugins')

const SENTORI_VERSION_KEY = 'SentoriSdkVersion'
const FIREBASE_BOM_VERSION = '33.5.1'
const GOOGLE_SERVICES_VERSION = '4.4.2'

// ── Existing marker (Sentori SDK version surface) ──────────────────

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{ sdkVersion?: string }} props
 */
const withSentoriVersion = (config, props = {}) => {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults[SENTORI_VERSION_KEY] = props.sdkVersion || '0.1.0'
    return cfg
  })
}

// ── v2.11 iOS push ─────────────────────────────────────────────────

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 */
const withSentoriPushIos = (config) => {
  config = withInfoPlist(config, (cfg) => {
    const modes = Array.isArray(cfg.modResults.UIBackgroundModes)
      ? cfg.modResults.UIBackgroundModes
      : []
    if (!modes.includes('remote-notification')) {
      modes.push('remote-notification')
    }
    cfg.modResults.UIBackgroundModes = modes
    return cfg
  })
  config = withEntitlementsPlist(config, (cfg) => {
    if (!cfg.modResults['aps-environment']) {
      // Xcode automatically swaps to 'development' when the build is
      // signed with a development provisioning profile, so this
      // default is correct for both flavors.
      cfg.modResults['aps-environment'] = 'production'
    }
    return cfg
  })
  return config
}

// ── v2.11 Android push ─────────────────────────────────────────────

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 */
const withSentoriPushAndroidManifest = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    AndroidConfig.Permissions.addPermission(
      manifest,
      'android.permission.POST_NOTIFICATIONS'
    )
    return cfg
  })
}

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 */
const withSentoriPushAndroidGradle = (config) => {
  // Root build.gradle: add google-services classpath.
  config = withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      const classpath = `classpath('com.google.gms:google-services:${GOOGLE_SERVICES_VERSION}')`
      if (!cfg.modResults.contents.includes('com.google.gms:google-services')) {
        cfg.modResults.contents = cfg.modResults.contents.replace(
          /(dependencies\s*\{)/,
          `$1\n        ${classpath}`
        )
      }
    }
    return cfg
  })
  // App build.gradle: apply plugin + firebase deps.
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg
    let contents = cfg.modResults.contents
    if (!contents.includes('com.google.gms.google-services')) {
      contents += `\napply plugin: 'com.google.gms.google-services'\n`
    }
    if (!contents.includes('firebase-bom')) {
      contents = contents.replace(
        /(dependencies\s*\{)/,
        `$1\n    implementation platform('com.google.firebase:firebase-bom:${FIREBASE_BOM_VERSION}')\n    implementation 'com.google.firebase:firebase-messaging'`
      )
    }
    cfg.modResults.contents = contents
    return cfg
  })
  return config
}

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{ googleServicesFile?: string }} props
 */
const withSentoriGoogleServicesJson = (config, props = {}) => {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const srcRel = props.googleServicesFile || './google-services.json'
      const projectRoot = cfg.modRequest.projectRoot
      const src = path.isAbsolute(srcRel) ? srcRel : path.join(projectRoot, srcRel)
      if (!fs.existsSync(src)) {
        // Don't fail the build; warn so the operator notices.
        // eslint-disable-next-line no-console
        console.warn(
          `[sentori-expo] google-services.json not found at ${src}; skipping copy. Push will work once the file is added + prebuild re-runs.`
        )
        return cfg
      }
      const platformRoot = cfg.modRequest.platformProjectRoot
      const dest = path.join(platformRoot, 'app', 'google-services.json')
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      return cfg
    },
  ])
}

// ── Composer ───────────────────────────────────────────────────────

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{ sdkVersion?: string, ios?: boolean, android?: boolean, googleServicesFile?: string }} [props]
 */
const withSentori = (config, props = {}) => {
  const plugins = [[withSentoriVersion, props]]
  if (props.ios !== false) plugins.push([withSentoriPushIos, props])
  if (props.android !== false) {
    plugins.push(
      [withSentoriPushAndroidManifest, props],
      [withSentoriPushAndroidGradle, props],
      [withSentoriGoogleServicesJson, props]
    )
  }
  return withPlugins(config, plugins)
}

module.exports = withSentori
