import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeDeckConfigFsrs,
  decodeDeckKind,
  fsrsFieldsForWeights,
  parseLegacyDeckFsrs,
  scanProtoFields,
} from './ankiDeckConfig';
import { DEFAULT_FSRS_WEIGHTS } from '../fsrs/constants';

/* ── protobuf builders (test helpers) ─────────────────────────────────── */

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

function tag(fieldNumber: number, wireType: number): number[] {
  return varint((fieldNumber << 3) | wireType);
}

function float32(value: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return Array.from(new Uint8Array(buf));
}

function lengthDelimited(fieldNumber: number, payload: Uint8Array | number[]): number[] {
  const data = payload instanceof Uint8Array ? Array.from(payload) : payload;
  return [...tag(fieldNumber, 2), ...varint(data.length), ...data];
}

function packedFloats(fieldNumber: number, values: number[]): number[] {
  return lengthDelimited(fieldNumber, values.flatMap(float32));
}

function fixed32Field(fieldNumber: number, value: number): number[] {
  return [...tag(fieldNumber, 5), ...float32(value)];
}

function varintField(fieldNumber: number, value: number): number[] {
  return [...tag(fieldNumber, 0), ...varint(value)];
}

const bytes = (...parts: (number[] | number[][])[]): Uint8Array =>
  Uint8Array.from(parts.flat());

/**
 * The real `deck_config.config` protobuf of the reference Anki export
 * (`Japanese2.apkg`, schema 18, options group 1 "Default").
 *
 * It carries `desired_retention = 0.9` (field 37) and
 * `historical_retention = 0.9` (field 40), but no FSRS weights — that
 * collection relies on Anki's built-in defaults.
 */
const REAL_DECK_CONFIG = Uint8Array.from(
  Buffer.from(
    '0a080000803f00002041120400002041221c0000' +
      '803f0000803f0000803f0000803f0000803f0000' +
      '803f0000803f481450c8015d00002040656666a6' +
      '3f6d9a99993f7d0000803f8001949d0288010190' +
      '0101980104a80101b00108c0013cad026666663f' +
      'c5026666663fe00201',
    'hex'
  )
);

/** The real `decks.kind` protobuf: a `Normal` message with `config_id = 1`. */
const REAL_DECK_KIND = Uint8Array.from(Buffer.from('0a020801', 'hex'));

describe('scanProtoFields', () => {
  it('reads varint, fixed32 and length-delimited fields', () => {
    const message = bytes(
      varintField(9, 20),
      fixed32Field(37, 0.9),
      lengthDelimited(1, [1, 2, 3])
    );
    const fields = scanProtoFields(message);
    assert.equal(fields.length, 3);
    assert.equal(fields[0].fieldNumber, 9);
    assert.equal(fields[0].varint, 20);
    assert.equal(fields[1].fieldNumber, 37);
    assert.equal(fields[2].fieldNumber, 1);
    assert.deepEqual(Array.from(fields[2].bytes!), [1, 2, 3]);
  });

  it('stops cleanly on a truncated message', () => {
    const fields = scanProtoFields(Uint8Array.from([0x0a, 0x05, 0x01]));
    assert.equal(fields.length, 1);
  });

  it('ignores an empty message', () => {
    assert.deepEqual(scanProtoFields(new Uint8Array(0)), []);
  });
});

describe('decodeDeckConfigFsrs', () => {
  it('reads the retention of the real Anki options group', () => {
    const fsrs = decodeDeckConfigFsrs(REAL_DECK_CONFIG);
    assert.ok(Math.abs(fsrs.desiredRetention! - 0.9) < 1e-6);
    assert.ok(Math.abs(fsrs.historicalRetention! - 0.9) < 1e-6);
    // The collection uses Anki's built-in weights — none are stored.
    assert.equal(fsrs.weights, undefined);
  });

  it('reads an FSRS-6 weight array (field 6)', () => {
    const message = bytes(packedFloats(6, DEFAULT_FSRS_WEIGHTS));
    const fsrs = decodeDeckConfigFsrs(message);
    assert.ok(fsrs.weights);
    assert.equal(fsrs.weights.length, 21);
    assert.ok(Math.abs(fsrs.weights[0] - DEFAULT_FSRS_WEIGHTS[0]) < 1e-6);
    assert.ok(Math.abs(fsrs.weights[20] - DEFAULT_FSRS_WEIGHTS[20]) < 1e-6);
  });

  it('reads an FSRS-5 weight array (field 5)', () => {
    const fsrs5 = DEFAULT_FSRS_WEIGHTS.slice(0, 19);
    const fsrs = decodeDeckConfigFsrs(bytes(packedFloats(5, fsrs5)));
    assert.ok(fsrs.weights);
    assert.equal(fsrs.weights.length, 19);
  });

  it('prefers FSRS-6 over FSRS-5, like Anki', () => {
    const fsrs5 = DEFAULT_FSRS_WEIGHTS.slice(0, 19);
    const message = bytes(
      packedFloats(5, fsrs5),
      packedFloats(6, DEFAULT_FSRS_WEIGHTS)
    );
    const fsrs = decodeDeckConfigFsrs(message);
    assert.equal(fsrs.weights!.length, 21);
  });

  it('falls back to the FSRS-4 array when nothing newer is present', () => {
    const fsrs4 = DEFAULT_FSRS_WEIGHTS.slice(0, 17);
    const fsrs = decodeDeckConfigFsrs(bytes(packedFloats(3, fsrs4)));
    assert.equal(fsrs.weights!.length, 17);
  });

  it('combines the retention and the weights', () => {
    const message = bytes(
      packedFloats(6, DEFAULT_FSRS_WEIGHTS),
      fixed32Field(37, 0.85)
    );
    const fsrs = decodeDeckConfigFsrs(message);
    assert.ok(Math.abs(fsrs.desiredRetention! - 0.85) < 1e-6);
    assert.equal(fsrs.weights!.length, 21);
  });

  it('returns nothing for a missing or empty blob', () => {
    assert.deepEqual(decodeDeckConfigFsrs(null), {});
    assert.deepEqual(decodeDeckConfigFsrs(new Uint8Array(0)), {});
  });
});

describe('decodeDeckKind', () => {
  it('reads the options group id of the real Anki deck', () => {
    assert.equal(decodeDeckKind(REAL_DECK_KIND).configId, 1);
  });

  it('reads a per-deck retention override (field 10)', () => {
    const normal = bytes(varintField(1, 7), fixed32Field(10, 0.92));
    const kind = bytes(lengthDelimited(1, normal));
    const decoded = decodeDeckKind(kind);
    assert.equal(decoded.configId, 7);
    assert.ok(Math.abs(decoded.desiredRetention! - 0.92) < 1e-6);
  });

  it('ignores filtered decks', () => {
    const filtered = bytes(lengthDelimited(2, [0x08, 0x01]));
    assert.deepEqual(decodeDeckKind(filtered), {});
  });

  it('returns nothing for a missing blob', () => {
    assert.deepEqual(decodeDeckKind(null), {});
  });
});

describe('parseLegacyDeckFsrs', () => {
  it('reads the camelCase fields Anki writes', () => {
    const fsrs = parseLegacyDeckFsrs({
      desiredRetention: 0.9,
      fsrsParams6: DEFAULT_FSRS_WEIGHTS,
      fsrsParams5: DEFAULT_FSRS_WEIGHTS.slice(0, 19),
    });
    assert.equal(fsrs.desiredRetention, 0.9);
    assert.equal(fsrs.weights!.length, 21);
  });

  it('reads the snake_case names some tools produce', () => {
    const fsrs = parseLegacyDeckFsrs({
      desired_retention: 0.8,
      fsrs_params_6: DEFAULT_FSRS_WEIGHTS,
    });
    assert.equal(fsrs.desiredRetention, 0.8);
    assert.equal(fsrs.weights!.length, 21);
  });

  it('prefers FSRS-6 over FSRS-5 over the legacy FSRS-4 array', () => {
    const fsrs5 = DEFAULT_FSRS_WEIGHTS.slice(0, 19);
    const fsrs4 = DEFAULT_FSRS_WEIGHTS.slice(0, 17);
    assert.equal(
      parseLegacyDeckFsrs({ fsrsParams6: DEFAULT_FSRS_WEIGHTS, fsrsParams5: fsrs5 }).weights!.length,
      21
    );
    assert.equal(parseLegacyDeckFsrs({ fsrsParams5: fsrs5 }).weights!.length, 19);
    assert.equal(parseLegacyDeckFsrs({ fsrsWeights: fsrs4 }).weights!.length, 17);
  });

  it('reads the historical retention', () => {
    assert.equal(parseLegacyDeckFsrs({ sm2Retention: 0.85 }).historicalRetention, 0.85);
  });

  it('ignores malformed entries', () => {
    assert.deepEqual(parseLegacyDeckFsrs(null), {});
    assert.deepEqual(parseLegacyDeckFsrs('nope'), {});
    assert.deepEqual(parseLegacyDeckFsrs({ fsrsParams6: 'nope' }), {});
  });
});

describe('fsrsFieldsForWeights', () => {
  it('writes an FSRS-6 set to fsrsParams6', () => {
    const fields = fsrsFieldsForWeights(DEFAULT_FSRS_WEIGHTS, 0.9);
    assert.equal(fields.fsrsParams6?.length, 21);
    assert.equal(fields.fsrsParams5, undefined);
    assert.equal(fields.desiredRetention, 0.9);
  });

  it('writes an FSRS-5 set to fsrsParams5', () => {
    const fields = fsrsFieldsForWeights(DEFAULT_FSRS_WEIGHTS.slice(0, 19), 0.9);
    assert.equal(fields.fsrsParams5?.length, 19);
    assert.equal(fields.fsrsParams6, undefined);
  });

  it('round-trips through the legacy parser', () => {
    const fields = fsrsFieldsForWeights(DEFAULT_FSRS_WEIGHTS, 0.87);
    const parsed = parseLegacyDeckFsrs(fields);
    assert.equal(parsed.desiredRetention, 0.87);
    assert.equal(parsed.weights!.length, 21);
  });

  it('ignores an invalid weight set', () => {
    assert.deepEqual(fsrsFieldsForWeights([1, 2, 3], 0.9), { desiredRetention: 0.9 });
    assert.deepEqual(fsrsFieldsForWeights(undefined, undefined), {});
  });
});
