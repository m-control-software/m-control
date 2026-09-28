/**
 * Chrome native messaging framing: each message is a 32-bit length in native
 * byte order (little-endian on every platform Chrome supports) followed by
 * that many bytes of UTF-8 JSON.
 *
 * Chrome caps host -> browser messages at 1 MB. Browser -> host may be up to
 * 64 MiB, but this host only ever expects a tiny {action, url}, so it applies
 * the same 1 MB cap both ways and treats anything larger as a protocol error.
 */

'use strict';

const MAX_MESSAGE_BYTES = 1024 * 1024;

class FramingError extends Error {
  constructor(message) {
    super(message);
    this.code = 'MESSAGE_INVALID';
  }
}

/** JSON value -> one framed message. Throws FramingError above the cap. */
function encode(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new FramingError(
      `Message of ${body.length} bytes exceeds the ${MAX_MESSAGE_BYTES}-byte limit.`
    );
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * An incremental decoder: push(chunk) returns every complete message so far.
 * A length above the cap or a body that isn't JSON throws FramingError.
 */
function createDecoder() {
  let buffered = Buffer.alloc(0);
  return {
    push(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const out = [];
      while (buffered.length >= 4) {
        const length = buffered.readUInt32LE(0);
        if (length > MAX_MESSAGE_BYTES) {
          throw new FramingError(
            `Incoming message of ${length} bytes exceeds the ${MAX_MESSAGE_BYTES}-byte limit.`
          );
        }
        if (buffered.length < 4 + length) break;
        const body = buffered.subarray(4, 4 + length).toString('utf8');
        buffered = buffered.subarray(4 + length);
        try {
          out.push(JSON.parse(body));
        } catch (err) {
          throw new FramingError(
            `Incoming message is not JSON: ${err.message}`
          );
        }
      }
      return out;
    },
    /** Bytes of an incomplete message still waiting for the rest. */
    pending: () => buffered.length,
  };
}

module.exports = { FramingError, MAX_MESSAGE_BYTES, createDecoder, encode };
