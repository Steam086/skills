import binascii
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from repair_png import repair


PNG_SIG = b"\x89PNG\r\n\x1a\n"


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def raw_deflate(data: bytes) -> bytes:
    compressor = zlib.compressobj(wbits=-15)
    return compressor.compress(data) + compressor.flush()


def one_pixel_png(extra_chunks: list[bytes] | None = None, truncated_iend: bool = False) -> bytes:
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\x00\x00\x00")
    chunks = [chunk(b"IHDR", ihdr), *(extra_chunks or []), chunk(b"IDAT", idat)]
    if truncated_iend:
        chunks.append(b"\x00\x00\x00\x00")
    else:
        chunks.append(chunk(b"IEND", b""))
    return PNG_SIG + b"".join(chunks)


def write_temp_png(data: bytes) -> Path:
    tmp = tempfile.NamedTemporaryFile("wb", suffix=".png", delete=False)
    tmp.write(data)
    tmp.close()
    return Path(tmp.name)


def ztxt_payload(path: Path) -> bytes:
    data = path.read_bytes()
    offset = len(PNG_SIG)
    while offset < len(data):
        size = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + size]
        if kind == b"zTXt":
            return payload
        offset += 12 + size
    raise AssertionError("missing zTXt chunk")


class RepairPngTest(unittest.TestCase):
    def test_repair_appends_missing_iend_chunk(self) -> None:
        path = write_temp_png(one_pixel_png(truncated_iend=True))

        changed = repair(str(path))

        self.assertTrue(changed)
        self.assertTrue(path.read_bytes().endswith(chunk(b"IEND", b"")))

    def test_repair_recompresses_raw_deflate_ztxt_as_png_zlib_stream(self) -> None:
        text = b"%3Cmxfile%3E%3C/mxfile%3E"
        ztxt = chunk(b"zTXt", b"mxGraphModel\x00\x00" + raw_deflate(text))
        path = write_temp_png(one_pixel_png([ztxt]))

        changed = repair(str(path))

        payload = ztxt_payload(path)
        nul_index = payload.index(b"\x00")
        self.assertTrue(changed)
        self.assertEqual(payload[:nul_index], b"mxGraphModel")
        self.assertEqual(payload[nul_index + 1], 0)
        self.assertEqual(zlib.decompress(payload[nul_index + 2 :]), text)


if __name__ == "__main__":
    unittest.main()
