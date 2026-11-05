/**
 * Anki's per-deck FSRS options — the "deck options group" side of the FSRS
 * scheduler.
 *
 * Anki keeps these values in one of two places, depending on the schema:
 *
 * - **schema 11 (legacy)** — the `col.dconf` JSON, a map of options groups.
 *   The struct is `DeckConfSchema11`, serialized with
 *   `#[serde(rename_all = "camelCase")]`, so the keys are camelCase:
 *   `desiredRetention`, `fsrsParams5`, `fsrsParams6` (and `fsrsWeights` for
 *   the ancient FSRS-4 array).
 *
 * - **schema 18** — the `deck_config` table, where the `config` column holds
 *   a **protobuf** `DeckConfig.Config` message
 *   (`proto/anki/deck_config.proto`):
 *
 *     repeated float fsrs_params_4 = 3;
 *     repeated float fsrs_params_5 = 5;
 *     repeated float fsrs_params_6 = 6;
 *     float desired_retention = 37;
 *     float historical_retention = 40;
 *
 * The decks point at their options group through `Deck.Normal.config_id`
 * (schema 18, inside the `decks.kind` blob) or through the legacy
 * `conf` field of the deck JSON.
 *
 * Anki resolves the weights with `DeckConfig::fsrs_params()`, which prefers
 * FSRS-6 and falls back to FSRS-5 and then FSRS-4 — the same precedence
 * used here.
 */

/** The FSRS-relevant part of an Anki deck options group. */
export interface AnkiDeckFsrs {
  /** `desired_retention` — the target retention (0.9 by default). */
  desiredRetention?: number;
  /** `historical_retention` — the retention used by the v3 rescheduler. */
  historicalRetention?: number;
  /** The FSRS weights, following Anki's fsrs_params() precedence. */
  weights?: number[];
  /** `maximum_review_interval` — the longest interval a card may get. */
  maximumInterval?: number;
}

/** An Anki deck options group, with the identity Anki gives it. */
export interface AnkiDeckOptions extends AnkiDeckFsrs {
  /** The options group id (`deck_config.id` / the `col.dconf` key). */
  id: number;
  /** The options group name ("Default", "My group", …). */
  name: string;
}

/** The JSON fields Anki uses for the FSRS options of a legacy options group. */
export interface AnkiLegacyFsrsFields {
  desiredRetention?: number;
  fsrsParams5?: number[];
  fsrsParams6?: number[];
}

/** Number of weights of an FSRS-5 parameter set. */
const FSRS_5_WEIGHT_COUNT = 19;
/** Number of weights of an FSRS-6 parameter set. */
const FSRS_6_WEIGHT_COUNT = 21;

/**
 * Builds the legacy JSON fields for an options group.
 *
 * Anki's `fsrs_params()` prefers FSRS-6 and falls back to FSRS-5, so a
 * 21-value set goes to `fsrsParams6` and a 19-value set to `fsrsParams5`.
 */
export function fsrsFieldsForWeights(
  weights: number[] | undefined,
  desiredRetention: number | undefined
): AnkiLegacyFsrsFields {
  const fields: AnkiLegacyFsrsFields = {};
  if (typeof desiredRetention === 'number' && Number.isFinite(desiredRetention)) {
    fields.desiredRetention = desiredRetention;
  }
  if (Array.isArray(weights)) {
    if (weights.length === FSRS_5_WEIGHT_COUNT) fields.fsrsParams5 = [...weights];
    else if (weights.length === FSRS_6_WEIGHT_COUNT) fields.fsrsParams6 = [...weights];
  }
  return fields;
}

/** Reads a numeric array that may be stored as a JSON array. */
function readNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const v of value) {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    out.push(n);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Reads the FSRS options of a legacy `col.dconf` entry.
 *
 * Accepts both the camelCase names Anki writes today and the snake_case
 * ones some third-party tools produce.
 */
export function parseLegacyDeckFsrs(entry: unknown): AnkiDeckFsrs {
  if (!entry || typeof entry !== 'object') return {};
  const record = entry as Record<string, unknown>;

  const desired = Number(
    record.desiredRetention ?? record.desired_retention ?? record.requestRetention
  );
  const historical = Number(
    record.sm2Retention ?? record.historical_retention ?? record.historicalRetention
  );
  const maxIvl = Number(
    (record.rev as Record<string, unknown> | undefined)?.maxIvl ??
      record.maxIvl ??
      record.maximum_review_interval
  );

  // Anki's precedence: FSRS-6 → FSRS-5 → FSRS-4 (`fsrsWeights`).
  const weights =
    readNumberArray(record.fsrsParams6) ??
    readNumberArray(record.fsrs_params_6) ??
    readNumberArray(record.fsrsParams5) ??
    readNumberArray(record.fsrs_params_5) ??
    readNumberArray(record.fsrsWeights) ??
    readNumberArray(record.fsrs_params_4);

  const result: AnkiDeckFsrs = {};
  if (Number.isFinite(desired)) result.desiredRetention = desired;
  if (Number.isFinite(historical)) result.historicalRetention = historical;
  if (weights) result.weights = weights;
  if (Number.isFinite(maxIvl) && maxIvl > 0) result.maximumInterval = maxIvl;
  return result;
}

/* ── minimal protobuf reader ──────────────────────────────────────────── */

/** A single field of a protobuf message. */
interface ProtoField {
  /** The field number. */
  fieldNumber: number;
  /** The wire type (0 varint, 1 fixed64, 2 length-delimited, 5 fixed32). */
  wireType: number;
  /** The varint value (wire type 0). */
  varint?: number;
  /** The raw bytes of a length-delimited field. */
  bytes?: Uint8Array;
  /** The raw 4 bytes of a fixed32 field (wire type 5). */
  fixed32?: Uint8Array;
}

/**
 * Scans the fields of a protobuf message.
 *
 * Only the wire types Anki's deck config uses are decoded; anything else is
 * skipped by its length, so unknown fields never break the parse.
 */
export function scanProtoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset < bytes.length) {
    // Tag: field number in the upper bits, wire type in the lower 3.
    let tag = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      tag |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) === 0) break;
      if (shift > 35) return fields; // malformed — stop
    }
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    if (fieldNumber === 0) return fields;

    const field: ProtoField = { fieldNumber, wireType };

    if (wireType === 0) {
      let value = 0;
      shift = 0;
      while (offset < bytes.length) {
        const byte = bytes[offset++];
        value += (byte & 0x7f) * Math.pow(2, shift);
        shift += 7;
        if ((byte & 0x80) === 0) break;
      }
      field.varint = value;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      let length = 0;
      shift = 0;
      while (offset < bytes.length) {
        const byte = bytes[offset++];
        length += (byte & 0x7f) * Math.pow(2, shift);
        shift += 7;
        if ((byte & 0x80) === 0) break;
      }
      const end = Math.min(offset + length, bytes.length);
      field.bytes = bytes.subarray(offset, end);
      offset = end;
    } else if (wireType === 5) {
      if (offset + 4 > bytes.length) return fields;
      field.fixed32 = bytes.subarray(offset, offset + 4);
      offset += 4;
    } else {
      // Groups (3/4) and unknown wire types — stop, the rest is unreadable.
      return fields;
    }

    fields.push(field);
  }

  return fields;
}

/** Reads a packed (or repeated) float field. */
function readFloats(field: ProtoField): number[] {
  if (!field.bytes) return [];
  const view = new DataView(field.bytes.buffer, field.bytes.byteOffset, field.bytes.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 4 <= field.bytes.length; i += 4) {
    out.push(view.getFloat32(i, true));
  }
  return out;
}

/** Reads a fixed32 field as a float (protobuf `float` is a 32-bit IEEE). */
function readFloat32(field: ProtoField): number | undefined {
  if (!field.fixed32 || field.fixed32.length < 4) return undefined;
  const view = new DataView(
    field.fixed32.buffer,
    field.fixed32.byteOffset,
    field.fixed32.byteLength
  );
  return view.getFloat32(0, true);
}

/**
 * Decodes the FSRS options of a schema-18 `deck_config.config` protobuf.
 *
 * The message is `DeckConfig.Config`; only the FSRS fields are read.
 */
export function decodeDeckConfigFsrs(bytes: Uint8Array | number[] | null): AnkiDeckFsrs {
  if (!bytes) return {};
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (data.length === 0) return {};

  const fields = scanProtoFields(data);

  const params4: number[] = [];
  const params5: number[] = [];
  const params6: number[] = [];
  let desiredRetention: number | undefined;
  let historicalRetention: number | undefined;
  let maximumInterval: number | undefined;

  for (const field of fields) {
    switch (field.fieldNumber) {
      case 3: // fsrs_params_4
        params4.push(...readFloats(field));
        break;
      case 5: // fsrs_params_5
        params5.push(...readFloats(field));
        break;
      case 6: // fsrs_params_6
        params6.push(...readFloats(field));
        break;
      case 16: // maximum_review_interval
        if (field.wireType === 0 && field.varint !== undefined && field.varint > 0) {
          maximumInterval = field.varint;
        }
        break;
      case 37: // desired_retention
        if (field.wireType === 5) {
          const value = readFloat32(field);
          if (value !== undefined) desiredRetention = value;
        }
        break;
      case 40: // historical_retention
        if (field.wireType === 5) {
          const value = readFloat32(field);
          if (value !== undefined) historicalRetention = value;
        }
        break;
      default:
        break;
    }
  }

  const result: AnkiDeckFsrs = {};
  if (desiredRetention !== undefined && Number.isFinite(desiredRetention)) {
    result.desiredRetention = desiredRetention;
  }
  if (historicalRetention !== undefined && Number.isFinite(historicalRetention)) {
    result.historicalRetention = historicalRetention;
  }
  // Anki's precedence: FSRS-6 → FSRS-5 → FSRS-4.
  const weights = params6.length ? params6 : params5.length ? params5 : params4;
  if (weights.length) result.weights = weights;
  if (maximumInterval !== undefined) result.maximumInterval = maximumInterval;
  return result;
}

/**
 * Decodes the options-group reference of a schema-18 deck.
 *
 * `decks.kind` holds a `Deck.KindContainer` whose `normal` field (1) is a
 * `Deck.Normal` message: `config_id` (1) points at the `deck_config` row,
 * and `desired_retention` (10) is Anki's per-deck retention override.
 */
export function decodeDeckKind(
  bytes: Uint8Array | number[] | null
): { configId?: number; desiredRetention?: number } {
  if (!bytes) return {};
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (data.length === 0) return {};

  const result: { configId?: number; desiredRetention?: number } = {};

  for (const field of scanProtoFields(data)) {
    // The oneof: field 1 = normal, field 2 = filtered.
    if (field.fieldNumber !== 1 || !field.bytes) continue;
    for (const inner of scanProtoFields(field.bytes)) {
      if (inner.fieldNumber === 1 && inner.wireType === 0 && inner.varint !== undefined) {
        result.configId = inner.varint;
      } else if (inner.fieldNumber === 10 && inner.wireType === 5) {
        const value = readFloat32(inner);
        if (value !== undefined) result.desiredRetention = value;
      }
    }
  }

  return result;
}

/** The FSRS scope of an imported deck, in Runora's terms. */
export interface AnkiDeckFsrsScope {
  /** The desired retention that applies to the deck. */
  requestRetention: number;
  /** The longest interval a card of the deck may get. */
  maximumInterval: number;
  /** The FSRS weights that apply to the deck (with them, the decay). */
  weights?: number[];
  /** Whether the deck carries its own retention override. */
  hasDeckOverride: boolean;
}

/**
 * Resolves the FSRS scope of an imported deck.
 *
 * In Anki a deck either follows an options group or overrides its
 * retention on its own; the weights always come from the group. The result
 * mirrors that: the deck's own retention wins, the group's fills in the
 * rest, and the app's global settings are the last resort.
 */
export function resolveAnkiDeckFsrsScope(
  options: AnkiDeckOptions | undefined,
  deckRetentionOverride: number | undefined,
  fallback: { requestRetention: number; maximumInterval: number }
): AnkiDeckFsrsScope {
  const requestRetention =
    deckRetentionOverride ?? options?.desiredRetention ?? fallback.requestRetention;
  const maximumInterval = options?.maximumInterval ?? fallback.maximumInterval;
  return {
    requestRetention,
    maximumInterval,
    weights: options?.weights,
    hasDeckOverride: deckRetentionOverride !== undefined,
  };
}
