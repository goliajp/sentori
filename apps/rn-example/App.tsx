import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  drainReplay,
  probeNativeScreenshot,
  probeNativeWireframe,
  sentori,
  startAnrWatchdog,
  triggerNativeCrash,
} from '@goliapkg/sentori-react-native';

const INGEST_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';

const TOKEN = 'st_pk_dev0000000000000000000000';

sentori.init({
  token: TOKEN,
  release: 'sentori-example@1.0.0+1',
  environment: 'dev',
  ingestUrl: INGEST_URL,
  capture: { replay: { mode: 'wireframe', hz: 2 } },
});

startAnrWatchdog({ force: true, intervalMs: 500, timeoutMs: 2000 });

type LogLine = { id: number; text: string };

export default function App() {
  const [log, setLog] = useState<LogLine[]>([]);

  const append = (text: string) => {
    setLog((prev) =>
      [{ id: Date.now() + Math.random(), text }, ...prev].slice(0, 10),
    );
  };

  const buttons: { onPress: () => void; title: string }[] = [
    {
      onPress: () => {
        append('throwing TypeError…');
        setTimeout(() => {
          const x = undefined as unknown as { foo: () => void };
          x.foo();
        }, 0);
      },
      title: 'Throw TypeError (global handler)',
    },
    {
      onPress: () => {
        append('rejecting promise…');
        void Promise.reject(new Error('unhandled rejection demo'));
      },
      title: 'Unhandled promise rejection',
    },
    {
      onPress: () => {
        append('captureError manual…');
        sentori.captureError(new Error('manual capture'), {
          tags: { source: 'button' },
        });
      },
      title: 'Manual sentori.captureError()',
    },
    {
      onPress: async () => {
        append('fetch then capture…');
        try {
          await fetch('http://localhost:9999/does-not-exist');
        } catch {
          /* expected */
        }
        sentori.captureError(new Error('after a failed fetch'));
      },
      title: 'fetch failure → capture',
    },
    {
      onPress: () => {
        append('triggering native crash…');
        triggerNativeCrash();
      },
      title: 'Native crash (relaunch sends)',
    },
    {
      onPress: () => {
        append('hanging main for 5s…');
        const start = Date.now();
        while (Date.now() - start < 5000) {
          /* busy-loop */
        }
        append('main resumed');
      },
      title: 'Hang main thread 5 s',
    },
    {
      onPress: () => {
        const p = probeNativeWireframe();
        const msg = `probe path=${p.lastPath} nodes=${p.lastNodes} scenes=${p.sceneCount} windows=${p.windowCount}`;
        append(msg);
        console.warn('[replay-test]', msg);
      },
      title: '[replay] probe wireframe state',
    },
    {
      onPress: () => {
        const p = probeNativeScreenshot();
        const tracked = (p.raw.trackedSource as string | undefined) ?? 'n/a';
        const decor = (p.raw.decorViewFound as boolean | undefined) ?? false;
        const msg = `probe screenshot path=${p.lastPath} tracked=${tracked} decor=${decor}`;
        append(msg);
        console.warn('[verify-android]', msg, p.raw);
      },
      title: '[screenshot] probe state',
    },
    {
      onPress: () => {
        const ndjson = drainReplay();
        const lines = ndjson ? ndjson.split('\n').length : 0;
        const head = ndjson.slice(0, 120).replace(/\n/g, ' | ');
        const msg = `drained frames=${lines} bytes=${ndjson.length}`;
        append(msg);
        console.warn('[replay-test]', msg, '\n  head:', head);
      },
      title: '[replay] drain ring (no crash)',
    },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Sentori</Text>
        <Text style={styles.subtitle}>example · Expo 55 · RN 0.83</Text>
        <Text style={styles.meta}>ingest: {INGEST_URL}</Text>
      </View>

      <View style={styles.buttons}>
        {buttons.map((b) => (
          <Pressable
            key={b.title}
            onPress={b.onPress}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          >
            <Text style={styles.btnLabel}>{b.title}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.logHeader}>
        <Text style={styles.logHeaderText}>recent</Text>
      </View>
      <ScrollView style={styles.log}>
        {log.length === 0 ? (
          <Text style={styles.logEmpty}>
            tap a button — then watch sentori-server stdout
          </Text>
        ) : (
          log.map((l) => (
            <Text key={l.id} style={styles.logLine}>
              {l.text}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: '#1a1a1f',
    borderColor: '#2a2a32',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  btnLabel: { color: '#e0e0e6', fontSize: 14 },
  btnPressed: { backgroundColor: '#222229' },
  buttons: { gap: 8, marginBottom: 24 },
  header: { marginBottom: 24 },
  log: { flex: 1 },
  logEmpty: {
    color: '#5a5a62',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  logHeader: {
    borderTopColor: '#1a1a1f',
    borderTopWidth: 1,
    marginBottom: 8,
    paddingTop: 12,
  },
  logHeaderText: {
    color: '#7a7a82',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  logLine: {
    color: '#a0a0a8',
    fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }),
    fontSize: 12,
    paddingVertical: 4,
  },
  meta: {
    color: '#5a5a62',
    fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }),
    fontSize: 11,
    marginTop: 8,
  },
  root: {
    backgroundColor: '#0e0e10',
    flex: 1,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 64,
  },
  subtitle: { color: '#7a7a82', fontSize: 14, marginTop: 2 },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
});
