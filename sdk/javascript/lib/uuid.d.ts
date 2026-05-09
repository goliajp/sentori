/**
 * uuid v7 (timestamp-prefixed). Modern Node ≥ 19 + browsers expose
 * `crypto.randomUUID()` for v4 — that gives us the entropy half;
 * v7 layout is cheap to assemble manually.
 *
 * Layout (RFC 9562 v7):
 *   ms (48 bits) | ver=7 (4) | rand_a (12) | var=10 (2) | rand_b (62)
 */
export declare function uuidV7(): string;
//# sourceMappingURL=uuid.d.ts.map