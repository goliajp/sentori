# sim-sentori-android — Android emulator verify workflow

Counterpart to `sim-sentori` (iOS). Use the emulator for routine rc.x verify cycles; reserve the S22 (`R5CT52DF07D`) for shipped-bit reproducibility checks against real-device drawable stacks.

## One-time setup

The Pixel 10 Pro AVD is already on this machine — no extra install needed:

```bash
~/Library/Android/sdk/emulator/emulator -list-avds
# → Pixel_10_Pro
```

If absent on a fresh machine, create via Android Studio's Device Manager → New Device → Pixel 10 Pro with the `android-37 google_apis_playstore arm64-v8a` system image.

## Boot the emulator (headless, ~30 s)

```bash
~/Library/Android/sdk/emulator/emulator -avd Pixel_10_Pro -no-snapshot -no-boot-anim -no-window \
  > /tmp/emulator.log 2>&1 &
disown
# wait until boot complete
until [ "$(adb -e shell getprop sys.boot_completed 2>/dev/null)" = "1" ]; do sleep 2; done
adb devices  # should list emulator-5554
```

`-no-window` runs without UI; if you want to *see* what's happening drop that flag. `-no-snapshot` skips the saved-state restore so each run is cold (faster boot to consistent state).

## Mock ingest server

The mock server in this runbook accepts replay attachments and dumps node colour distribution to logs so you can verify walker output without prod-ingest auth:

```bash
cat > /tmp/mock-ingest.ts <<'EOF'
Bun.serve({
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname.includes('/attachments/replay')) {
      const form = await req.formData()
      const file = form.get('file')
      const utf8 = (file instanceof Blob) ? await file.text() : ''
      console.log(`replay bytes=${utf8.length}`)
      const colors = new Set(utf8.match(/"color":"#[0-9A-Fa-f]+"/g) || [])
      console.log(`color-field-count=${(utf8.match(/"color":/g) || []).length}`)
      console.log('uniq-colors:', [...colors].join(' '))
      return new Response(JSON.stringify({ kind:'replay', mediaType:'application/x-ndjson', refId:'019e3000-7000-7000-8000-00000000abcd', sizeBytes:500 }), { status: 201 })
    }
    if (url.pathname.includes('/v1/events')) return new Response('{}', { status: 201 })
    return new Response('{}', { status: 200 })
  },
})
EOF
bun /tmp/mock-ingest.ts > /tmp/mock-ingest.log 2>&1 &
disown
```

The emulator already routes `10.0.2.2` → host loopback, so `rn-example`'s default `INGEST_URL` (`http://10.0.2.2:8080`) Just Works against this mock without any `adb reverse` setup.

## Install + launch + connect to metro

```bash
cd apps/rn-example/android
ANDROID_SERIAL=emulator-5554 ./gradlew :app:installDebug

# Start metro on port 8082 (Insight owns 8081)
cd ..  # back to apps/rn-example
bunx expo start --dev-client --port 8082 --clear > /tmp/metro-sentori.log 2>&1 &
disown

# adb reverse so the dev-launcher (inside the emulator) can reach metro on host
adb -s emulator-5554 reverse tcp:8080 tcp:8080
adb -s emulator-5554 reverse tcp:8082 tcp:8082

# Hand the metro URL to the dev launcher via deep link — bypasses the
# tap-around-the-launcher-menu dance
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d 'exp+sentori-example://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082'

# If the developer-menu sheet pops on first launch, dismiss it:
adb -s emulator-5554 shell input keyevent KEYCODE_BACK
```

## Trigger captureError + read the replay payload

```bash
# Find the captureError button's centre via uiautomator
adb -s emulator-5554 shell uiautomator dump >/dev/null
adb -s emulator-5554 pull /sdcard/window_dump.xml /tmp/ui.xml >/dev/null

python3 -c "
import re
x = open('/tmp/ui.xml').read()
for m in re.finditer(r'text=\"Manual sentori\.captureError\(\)\"[^/]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', x):
  cx = (int(m.group(1)) + int(m.group(3))) // 2
  cy = (int(m.group(2)) + int(m.group(4))) // 2
  print(f'tap {cx} {cy}')
"
# Then:
adb -s emulator-5554 shell input tap <cx> <cy>

# Wait, read the mock log:
cat /tmp/mock-ingest.log
# Expect:
#   replay bytes=N
#   color-field-count=N   (cumulative across frames in the ring)
#   uniq-colors: "color":"#XXXXXXXX" ...
```

## Cleanup

```bash
kill $(lsof -ti :8080) 2>/dev/null  # mock ingest
kill $(lsof -ti :8082) 2>/dev/null  # metro
adb -s emulator-5554 emu kill        # shut emulator
```

Also good to `cd apps/rn-example/android && ./gradlew --stop` if you triggered a full clean rebuild that left Gradle daemons.

## Why not just use the S22?

Both work. Emulator advantages:
- No USB cable / device-pairing fiddling
- Multiple emulators can run in parallel (e.g. one Android 14, one Android 16, one new-arch on, one off) — useful for "does this fix break older API levels?"
- Headless `-no-window` keeps the laptop screen free

S22 advantages:
- Real OEM drawable stack — Samsung's One UI sometimes ships custom Drawable subclasses our reflection-fallback might miss
- Real hardware ANR / vsync behaviour
- The exact device Insight reports against

Keep both in the toolbox; default to emulator for fast iteration.
