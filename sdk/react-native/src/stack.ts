import type { Frame } from './types';

// V8 / Hermes (RN 0.71+):
//   "    at functionName (file:line:col)"
//   "    at file:line:col"
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::(\d+))?(?::(\d+))?\)?\s*$/;

// SpiderMonkey / older Hermes:
//   "functionName@file:line:col"
const AT_FRAME = /^(.+?)@(.+?)(?::(\d+))?(?::(\d+))?$/;

export const parseStack = (stack: string | undefined): Frame[] => {
  if (!stack || typeof stack !== 'string') return [];
  const lines = stack.split('\n');
  const frames: Frame[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Skip the "ErrorType: message" header line.
    if (!line.startsWith('at ') && !line.includes('@')) continue;

    const frame = parseV8(line) ?? parseAt(line);
    if (frame) frames.push(frame);
  }

  return frames;
};

const parseV8 = (line: string): Frame | null => {
  if (!line.startsWith('at ')) return null;
  const m = V8_FRAME.exec(line);
  if (!m) return null;

  const fn = m[1] ? m[1].trim() : undefined;
  const file = m[2] ? m[2].trim() : '<anonymous>';
  const lineNo = m[3] ? parseInt(m[3], 10) : 0;
  const col = m[4] ? parseInt(m[4], 10) : undefined;

  return {
    function: fn,
    file,
    line: lineNo,
    column: col,
    inApp: isInApp(file),
  };
};

const parseAt = (line: string): Frame | null => {
  const m = AT_FRAME.exec(line);
  if (!m) return null;

  const fn = m[1] ? m[1].trim() : undefined;
  const file = m[2] ? m[2].trim() : '<anonymous>';
  const lineNo = m[3] ? parseInt(m[3], 10) : 0;
  const col = m[4] ? parseInt(m[4], 10) : undefined;

  return {
    function: fn,
    file,
    line: lineNo,
    column: col,
    inApp: isInApp(file),
  };
};

const isInApp = (file: string): boolean => {
  if (!file || file === '<anonymous>') return false;
  if (file.includes('node_modules/')) return false;
  if (/^https?:\/\//.test(file)) return false;
  return true;
};
