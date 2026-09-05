"""Repair malformed chunks in draw.io -e PNG exports.

draw.io's CLI emits -e PNGs with the 4-byte IEND length field but missing
the 8 bytes of "IEND" type + CRC. Strict PNG decoders and vision APIs
(Anthropic included) reject the file with 400 "Could not process image".
Some draw.io versions also write embedded mxGraphModel zTXt data with a raw
deflate stream instead of a PNG-valid zlib stream. SVG/PDF are unaffected.

Usage: python repair_png.py <path/to/diagram.drawio.png>

Idempotent: valid zTXt chunks and complete IEND chunks are left untouched, so
it's safe to run unconditionally after every -e PNG export.

Originally vendored from `.claude/skills/drawio-skill/scripts/repair_png.py`
and kept self-contained here — clones of this repo that don't have the
drawio-skill skill installed can still run the post-export repair.
"""
import binascii
import struct
import sys
import zlib

IEND = b"\x00\x00\x00\x00IEND\xaeB`\x82"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _repair_ztxt_payload(payload: bytes) -> tuple[bytes, bool]:
    nul_index = payload.find(b"\x00")
    if nul_index < 0 or nul_index + 1 >= len(payload):
        return payload, False

    keyword = payload[:nul_index]
    compression_method = payload[nul_index + 1]
    compressed = payload[nul_index + 2 :]
    if compression_method != 0:
        return payload, False

    try:
        zlib.decompress(compressed)
        return payload, False
    except zlib.error:
        pass

    try:
        text = zlib.decompress(compressed, wbits=-15)
    except zlib.error:
        return payload, False

    return keyword + b"\x00\x00" + zlib.compress(text), True


def _repair_ztxt_chunks(data: bytes) -> tuple[bytes, bool]:
    if not data.startswith(PNG_SIGNATURE):
        return data, False

    changed = False
    output = bytearray(PNG_SIGNATURE)
    offset = len(PNG_SIGNATURE)
    while offset + 8 <= len(data):
        size = struct.unpack(">I", data[offset : offset + 4])[0]
        end = offset + 12 + size
        if end > len(data):
            break

        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + size]
        if kind == b"zTXt":
            payload, payload_changed = _repair_ztxt_payload(payload)
            if payload_changed:
                output.extend(_chunk(kind, payload))
                changed = True
            else:
                output.extend(data[offset:end])
        else:
            output.extend(data[offset:end])
        offset = end

    output.extend(data[offset:])
    return bytes(output), changed


def repair(path: str) -> bool:
    with open(path, "rb") as f:
        data = f.read()

    data, changed = _repair_ztxt_chunks(data)
    if data.endswith(IEND):
        if changed:
            with open(path, "wb") as f:
                f.write(data)
        return changed

    if data.endswith(b"\x00\x00\x00\x00"):
        data = data[:-4]
    with open(path, "wb") as f:
        f.write(data + IEND)
    return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: repair_png.py <path>", file=sys.stderr)
        sys.exit(2)
    if repair(sys.argv[1]):
        print(f"repaired {sys.argv[1]}")
