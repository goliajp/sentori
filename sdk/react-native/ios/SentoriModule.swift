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

        // Dev-only helper used by the example app to verify the
        // crash-write / drain round-trip without writing native code in
        // the host app. Schedules a real NSException after a tick so
        // the JS bridge has time to return; the resulting crash hits
        // SentoriCrashHandler and writes a JSON file under
        // <Documents>/sentori/pending/.
        Function("triggerTestNativeCrash") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                NSException(
                    name: NSExceptionName("SentoriTestException"),
                    reason: "Sentori test native crash",
                    userInfo: nil
                ).raise()
            }
        }
    }
}
