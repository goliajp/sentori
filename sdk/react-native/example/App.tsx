import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  sentori,
  startAnrWatchdog,
  triggerNativeCrash,
} from '@goliapkg/sentori-react-native';

// iOS simulator can reach the host's localhost directly.
// Android emulator must use 10.0.2.2 to reach the host.
const INGEST_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';

const TOKEN = 'st_pk_dev0000000000000000000000';

sentori.init({
  token: TOKEN,
  release: 'sentori-example@1.0.0+1',
  environment: 'dev',
  ingestUrl: INGEST_URL,
});

// Phase 29 sub-A e2e: start the hang watchdog with force=true so it
// runs in this debug build. 2 s timeout means a 5-second main-thread
// busy loop trips it; 500 ms tick interval keeps detection prompt.
startAnrWatchdog({ force: true, timeoutMs: 2000, intervalMs: 500 });

type LogLine = { id: number; text: string };

export default function App(): React.JSX.Element {
  const [log, setLog] = useState<LogLine[]>([]);

  const append = (text: string) => {
    setLog((prev) =>
      [{ id: Date.now() + Math.random(), text }, ...prev].slice(0, 8),
    );
  };

  const buttons: { title: string; onPress: () => void }[] = [
    {
      title: 'Throw TypeError (caught by global handler)',
      onPress: () => {
        append('throwing TypeError…');
        setTimeout(() => {
          const x = undefined as unknown as { foo: () => void };
          x.foo();
        }, 0);
      },
    },
    {
      title: 'Unhandled promise rejection',
      onPress: () => {
        append('rejecting promise…');
        void Promise.reject(new Error('unhandled rejection demo'));
      },
    },
    {
      title: 'Manual sentori.captureError(...)',
      onPress: () => {
        append('captureError manual…');
        sentori.captureError(new Error('manual capture'), {
          tags: { source: 'button' },
        });
      },
    },
    {
      title: 'fetch failure → breadcrumb + capture',
      onPress: async () => {
        append('fetch then capture…');
        try {
          await fetch('http://localhost:9999/does-not-exist');
        } catch {
          // expected
        }
        sentori.captureError(new Error('after a failed fetch'));
      },
    },
    {
      title: 'Native crash (closes app — relaunch to send)',
      onPress: () => {
        append('triggering native crash…');
        triggerNativeCrash();
      },
    },
    {
      title: 'Hang main thread (5s — Phase 29 sub-A)',
      onPress: () => {
        append('hanging main for 5s…');
        const start = Date.now();
        // Busy-loop on the JS thread (= iOS RN main thread). The
        // watchdog tick runs on a background dispatch queue, sees
        // main hasn't ack'd within 2s, and fires the sampler.
        while (Date.now() - start < 5000) {
          // intentionally empty
        }
        append('main resumed');
      },
    },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Sentori</Text>
        <Text style={styles.subtitle}>example</Text>
        <Text style={styles.meta}>ingest: {INGEST_URL}</Text>
        <Text style={styles.meta}>release: sentori-example@1.0.0+1</Text>
      </View>

      <View style={styles.buttons}>
        {buttons.map((b) => (
          <Pressable
            key={b.title}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={b.onPress}
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
            tap a button — then watch the sentori-server stdout
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
  root: {
    flex: 1,
    backgroundColor: '#0e0e10',
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#7a7a82',
    fontSize: 14,
    marginTop: 2,
  },
  meta: {
    color: '#5a5a62',
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    marginTop: 8,
  },
  buttons: {
    gap: 8,
    marginBottom: 24,
  },
  btn: {
    backgroundColor: '#1a1a1f',
    borderColor: '#2a2a32',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  btnPressed: {
    backgroundColor: '#222229',
  },
  btnLabel: {
    color: '#e0e0e6',
    fontSize: 14,
  },
  logHeader: {
    borderTopColor: '#1a1a1f',
    borderTopWidth: 1,
    paddingTop: 12,
    marginBottom: 8,
  },
  logHeaderText: {
    color: '#7a7a82',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  log: {
    flex: 1,
  },
  logLine: {
    color: '#a0a0a8',
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    paddingVertical: 4,
  },
  logEmpty: {
    color: '#5a5a62',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
});
