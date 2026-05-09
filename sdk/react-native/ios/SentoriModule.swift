import ExpoModulesCore

/// Expo Module exposing the iOS crash handler to JS.
///
/// JS contract (mirrored in src/native.ts):
///   - setConfig({ token, release, environment }): stash for the crash
///     writer. Token is currently unused at native side; release and
///     environment are baked into the saved event JSON.
///   - drainPending() → string[]: read & delete all pending crash files
///     from <Documents>/sentori/pending and return their JSON bodies.
public class SentoriModule: Module {
    public func definition() -> ModuleDefinition {
        Name("Sentori")

        OnCreate {
            SentoriCrashHandler.register()
        }

        Function("setConfig") { (config: [String: Any]) in
            SentoriCrashHandler.setConfig(config)
        }

        AsyncFunction("drainPending") { () -> [String] in
            return SentoriCrashHandler.consumePending()
        }
    }
}
