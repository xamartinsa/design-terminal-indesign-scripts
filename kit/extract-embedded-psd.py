# Reads embedded images out of a PDF-compatible .ai and writes them out with the same pixels.
#
# - Flate images (RGB / CMYK / Gray, also palette = Indexed) -> PSD.
# - JPEG (DCTDecode) without a soft mask -> the JPEG bytes as they are, a .jpg file.
#   With a soft mask -> decoded and written as PSD with transparency.
#
# PSD rules that matter here (Photoshop file format):
# - CMYK samples are stored inverted: 255 = no ink. PDF stores them straight (0 = no ink),
#   so CMYK has to be flipped, otherwise InDesign shows a negative.
# - Soft transparency has to live in a layer (channel -1). A plain extra channel is just an
#   alpha channel and InDesign ignores it, so transparent areas came out black.
#   With a negative layer count the first extra channel of the composite is the merged
#   transparency, and the composite colors are matted on white, as Photoshop writes them.
#
# Every file name carries the PDF object number: two different images of the same size
# used to overwrite each other (embedded-900x600.psd) and InDesign got the wrong picture.

import io
import json
import os
import re
import struct
import sys
import zlib

import numpy as np

MODE_GRAY = 1
MODE_RGB = 3
MODE_CMYK = 4
MODE_NAMES = {MODE_GRAY: "Gray", MODE_RGB: "RGB", MODE_CMYK: "CMYK"}


class PdfData:
    def __init__(self, data):
        self.data = data
        self._offsets = None

    def offsets(self):
        if self._offsets is None:
            self._offsets = {}
            for m in re.finditer(rb"(?<![\d])(\d+)\s+0\s+obj\b", self.data):
                self._offsets[int(m.group(1))] = m.end()
        return self._offsets

    def object_text(self, num):
        pos = self.offsets().get(num)
        if pos is None:
            return None
        end_obj = self.data.find(b"endobj", pos)
        stream_kw = self.data.find(b"stream", pos)
        end = end_obj if end_obj >= 0 else len(self.data)
        if 0 <= stream_kw < end:
            end = stream_kw
        return self.data[pos:end].decode("latin1", errors="replace").strip()

    def stream_bytes(self, num):
        pos = self.offsets().get(num)
        if pos is None:
            return None
        text = self.object_text(num)
        stream_kw = self.data.find(b"stream", pos)
        if stream_kw < 0:
            return None
        start = stream_kw + len(b"stream")
        if self.data[start:start + 2] == b"\r\n":
            start += 2
        elif self.data[start:start + 1] in (b"\n", b"\r"):
            start += 1
        length = self.resolve_number(text, "Length")
        if length is None:
            end = self.data.find(b"endstream", start)
            length = end - start
        blob = self.data[start:start + length]
        if "FlateDecode" in text:
            try:
                return zlib.decompress(blob)
            except zlib.error:
                return None
        return blob

    def resolve_number(self, text, name):
        m = re.search(r"/" + name + r"\s+(\d+)(\s+0\s+R)?", text)
        if not m:
            return None
        if not m.group(2):
            return int(m.group(1))
        ref = self.object_text(int(m.group(1)))
        if ref is None:
            return None
        mm = re.match(r"\s*(\d+)", ref)
        return int(mm.group(1)) if mm else None


def parse_pdf_string(text):
    """Bytes of a PDF literal (...) or hex <...> string at the start of text."""
    text = text.lstrip()
    if text.startswith("<"):
        end = text.index(">")
        hexdigits = re.sub(r"\s+", "", text[1:end])
        if len(hexdigits) % 2:
            hexdigits += "0"
        return bytes.fromhex(hexdigits)
    if text.startswith("("):
        out = bytearray()
        depth = 0
        i = 1
        raw = text.encode("latin1")
        while i < len(raw):
            c = raw[i]
            if c == 0x5C:  # backslash
                i += 1
                n = raw[i]
                table = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
                if n in table:
                    out.append(table[n])
                elif 0x30 <= n <= 0x37:
                    digits = bytes([n])
                    while len(digits) < 3 and i + 1 < len(raw) and 0x30 <= raw[i + 1] <= 0x37:
                        i += 1
                        digits += bytes([raw[i]])
                    out.append(int(digits, 8) & 0xFF)
                elif n in (0x0A, 0x0D):
                    pass
                else:
                    out.append(n)
            elif c == 0x28:
                depth += 1
                out.append(c)
            elif c == 0x29:
                if depth == 0:
                    break
                depth -= 1
                out.append(c)
            else:
                out.append(c)
            i += 1
        return bytes(out)
    return None


def resolve_colorspace(pdf, text):
    """Returns dict(mode=..., channels=..., palette=None|ndarray(hival+1, n))."""
    text = text.strip()
    ref = re.match(r"(\d+)\s+0\s+R", text)
    if ref:
        inner = pdf.object_text(int(ref.group(1)))
        return resolve_colorspace(pdf, inner or "")
    if text.startswith("/DeviceRGB") or text.startswith("/CalRGB"):
        return {"mode": MODE_RGB, "channels": 3, "palette": None}
    if text.startswith("/DeviceCMYK"):
        return {"mode": MODE_CMYK, "channels": 4, "palette": None}
    if text.startswith("/DeviceGray") or text.startswith("/CalGray"):
        return {"mode": MODE_GRAY, "channels": 1, "palette": None}
    if text.startswith("["):
        body = text[1:].strip()
        if body.startswith("/ICCBased"):
            m = re.match(r"/ICCBased\s+(\d+)\s+0\s+R", body)
            n = pdf.resolve_number(pdf.object_text(int(m.group(1))) or "", "N") if m else None
            mode = {1: MODE_GRAY, 3: MODE_RGB, 4: MODE_CMYK}.get(n)
            return {"mode": mode, "channels": n, "palette": None} if mode else None
        if body.startswith("/Indexed") or body.startswith("/I "):
            rest = re.sub(r"^/Indexed", "", body).strip()
            # base colorspace: a name, a reference, or an array
            if rest.startswith("/"):
                m = re.match(r"(/\w+)", rest)
                base_text = m.group(1)
                rest = rest[m.end():].strip()
            elif re.match(r"\d+\s+0\s+R", rest):
                m = re.match(r"(\d+\s+0\s+R)", rest)
                base_text = m.group(1)
                rest = rest[m.end():].strip()
            elif rest.startswith("["):
                end = rest.index("]")
                base_text = rest[:end + 1]
                rest = rest[end + 1:].strip()
            else:
                return None
            base = resolve_colorspace(pdf, base_text)
            if not base or base["palette"] is not None:
                return None
            m = re.match(r"(\d+)", rest)
            hival = int(m.group(1))
            rest = rest[m.end():].strip()
            lookup_ref = re.match(r"(\d+)\s+0\s+R", rest)
            if lookup_ref:
                lookup = pdf.stream_bytes(int(lookup_ref.group(1)))
            else:
                lookup = parse_pdf_string(rest)
            if lookup is None:
                return None
            n = base["channels"]
            need = (hival + 1) * n
            lookup = (lookup + b"\x00" * need)[:need]
            palette = np.frombuffer(lookup, dtype=np.uint8).reshape(hival + 1, n)
            return {"mode": base["mode"], "channels": n, "palette": palette}
    return None


def read_image_objects(pdf):
    data = pdf.data
    objects = {}
    for m in re.finditer(rb"/Subtype\s*/Image", data):
        pos = m.start()
        window_start = max(0, pos - 4000)
        heads = list(re.finditer(rb"(\d+)\s+0\s+obj", data[window_start:pos]))
        if not heads:
            continue
        obj_num = int(heads[-1].group(1))
        text = pdf.object_text(obj_num)
        if not text:
            continue
        cs = re.search(r"/ColorSpace\s*(\d+\s+0\s+R|/\w+|\[[^\]]*\])", text)
        filt = re.search(r"/Filter\s*(\[[^\]]*\]|/\w+)", text)
        predictor = re.search(r"/Predictor\s+(\d+)", text)
        decode = re.search(r"/Decode\s*\[([^\]]*)\]", text)
        smask = re.search(r"/SMask\s+(\d+)\s+0\s+R", text)
        objects[obj_num] = {
            "num": obj_num,
            "width": pdf.resolve_number(text, "Width"),
            "height": pdf.resolve_number(text, "Height"),
            "bpc": pdf.resolve_number(text, "BitsPerComponent"),
            "smask": int(smask.group(1)) if smask else None,
            "filter": filt.group(1) if filt else "",
            "predictor": int(predictor.group(1)) if predictor else 1,
            "decode": decode.group(1).split() if decode else None,
            "colorspace": cs.group(1) if cs else "",
        }
    return objects


def invert_by_decode(planes, decode):
    if not decode:
        return planes
    planes = planes.copy()
    for c in range(min(planes.shape[0], len(decode) // 2)):
        try:
            if float(decode[2 * c]) > float(decode[2 * c + 1]):
                planes[c] = 255 - planes[c]
        except ValueError:
            pass
    return planes


def read_pixels(pdf, obj):
    """Color planes (channels, h, w) in the image's own mode, palette already expanded."""
    if not (obj["width"] and obj["height"]):
        return None, None, "no size"
    if obj["bpc"] != 8:
        return None, None, "bits per component %s" % obj["bpc"]
    if obj["predictor"] > 1:
        return None, None, "predictor %s" % obj["predictor"]
    cs = resolve_colorspace(pdf, obj["colorspace"]) if obj["colorspace"] else {"mode": MODE_GRAY, "channels": 1, "palette": None}
    if not cs:
        return None, None, "colorspace %s" % obj["colorspace"]
    w, h = obj["width"], obj["height"]
    if "DCTDecode" in obj["filter"]:
        from PIL import Image
        blob = pdf.stream_bytes(obj["num"])
        img = Image.open(io.BytesIO(blob))
        img.load()
        arr = np.asarray(img)
        if arr.ndim == 2:
            arr = arr[:, :, None]
        planes = np.ascontiguousarray(arr.transpose(2, 0, 1))
        planes = invert_by_decode(planes, obj["decode"])
        return planes, cs["mode"], ""
    if "FlateDecode" not in obj["filter"]:
        return None, None, "filter %s" % obj["filter"]
    raw = pdf.stream_bytes(obj["num"])
    if raw is None:
        return None, None, "inflate failed"
    count = w * h
    if not count or len(raw) % count:
        return None, None, "pixel size does not match %sx%s" % (w, h)
    channels = len(raw) // count
    planes = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, channels)
    planes = np.ascontiguousarray(planes.transpose(2, 0, 1))
    if cs["palette"] is not None:
        if channels != 1:
            return None, None, "indexed with %d channels" % channels
        index = planes[0]
        if obj["decode"] and len(obj["decode"]) >= 2 and float(obj["decode"][0]) > float(obj["decode"][1]):
            index = cs["palette"].shape[0] - 1 - index
        index = np.clip(index, 0, cs["palette"].shape[0] - 1)
        expanded = cs["palette"][index]  # h, w, n
        return np.ascontiguousarray(expanded.transpose(2, 0, 1)), cs["mode"], ""
    if channels != cs["channels"]:
        return None, None, "%d channels for %s" % (channels, obj["colorspace"])
    return invert_by_decode(planes, obj["decode"]), cs["mode"], ""


def read_alpha(pdf, objects, obj):
    if not obj["smask"] or obj["smask"] not in objects:
        return None
    planes, _mode, _why = read_pixels(pdf, objects[obj["smask"]])
    if planes is None or planes.shape[0] != 1:
        return None
    alpha = planes[0]
    if alpha.shape != (obj["height"], obj["width"]):
        from PIL import Image
        alpha = np.asarray(Image.fromarray(alpha).resize((obj["width"], obj["height"]), Image.BILINEAR))
    if int(alpha.min()) == 255:
        return None
    return alpha


def to_psd_samples(plane, mode):
    return (255 - plane) if mode == MODE_CMYK else plane


def matte_on_white(plane, alpha, mode):
    a = alpha.astype(np.uint16)
    p = plane.astype(np.uint16)
    if mode == MODE_CMYK:
        # ink * a: white paper has no ink
        return ((p * a + 127) // 255).astype(np.uint8)
    return ((p * a + 255 * (255 - a) + 127) // 255).astype(np.uint8)


def write_psd(path, color_planes, mode, alpha):
    channels, height, width = color_planes.shape
    plane_size = width * height
    with open(path, "wb") as out:
        header_channels = channels + (1 if alpha is not None else 0)
        out.write(struct.pack(">4sH6sHIIHH", b"8BPS", 1, b"\x00" * 6, header_channels, height, width, 8, mode))
        out.write(struct.pack(">I", 0))  # color mode data
        out.write(struct.pack(">I", 0))  # image resources

        if alpha is None:
            out.write(struct.pack(">I", 0))  # no layers
            out.write(struct.pack(">H", 0))  # raw composite
            for c in range(channels):
                out.write(to_psd_samples(color_planes[c], mode).tobytes())
            return

        layer_ids = [-1] + list(range(channels))
        name = b"Layer 1"
        name_block = bytes([len(name)]) + name
        name_block += b"\x00" * ((4 - len(name_block) % 4) % 4)
        extra = struct.pack(">II", 0, 0) + name_block
        record = struct.pack(">iiii", 0, 0, height, width)
        record += struct.pack(">H", len(layer_ids))
        for cid in layer_ids:
            record += struct.pack(">hI", cid, 2 + plane_size)
        record += b"8BIM" + b"norm" + struct.pack(">BBBB", 255, 0, 0x08, 0)
        record += struct.pack(">I", len(extra)) + extra

        layer_info_len = 2 + len(record) + len(layer_ids) * (2 + plane_size)
        pad = (4 - layer_info_len % 4) % 4
        layer_info_len += pad
        out.write(struct.pack(">I", 4 + layer_info_len + 4))  # layer and mask section
        out.write(struct.pack(">I", layer_info_len))
        out.write(struct.pack(">h", -1))  # negative: first extra channel = merged transparency
        out.write(record)
        out.write(struct.pack(">H", 0) + alpha.tobytes())
        for c in range(channels):
            out.write(struct.pack(">H", 0) + to_psd_samples(color_planes[c], mode).tobytes())
        out.write(b"\x00" * pad)
        out.write(struct.pack(">I", 0))  # global layer mask info

        out.write(struct.pack(">H", 0))  # raw composite
        for c in range(channels):
            out.write(to_psd_samples(matte_on_white(color_planes[c], alpha, mode), mode).tobytes())
        out.write(alpha.tobytes())


def export_image(pdf, objects, obj, out_dir):
    w, h = obj["width"], obj["height"]
    base = "embedded-%d-%dx%d" % (obj["num"], w, h)
    is_jpeg = "DCTDecode" in obj["filter"] and "FlateDecode" not in obj["filter"]
    if is_jpeg and not obj["smask"]:
        cs = resolve_colorspace(pdf, obj["colorspace"]) if obj["colorspace"] else None
        if cs and cs["palette"] is None:
            path = os.path.join(out_dir, base + ".jpg")
            with open(path, "wb") as handle:
                handle.write(pdf.stream_bytes(obj["num"]))
            return path, cs["mode"], False, "jpeg as is"
    planes, mode, why = read_pixels(pdf, obj)
    if planes is None:
        return None, None, False, why
    alpha = read_alpha(pdf, objects, obj)
    path = os.path.join(out_dir, base + ".psd")
    write_psd(path, planes, mode, alpha)
    return path, mode, alpha is not None, ""


def main():
    if len(sys.argv) < 3 or sys.argv[1] != "--args":
        raise SystemExit("usage: extract-embedded-psd.py --args args.txt")
    lines = open(sys.argv[2], "r", encoding="utf-8-sig").read().splitlines()
    ai_path, out_dir, result_path = lines[0], lines[1], lines[2]
    os.makedirs(out_dir, exist_ok=True)
    images = []
    notes = []
    error = ""
    try:
        pdf = PdfData(open(ai_path, "rb").read())
        objects = read_image_objects(pdf)
        mask_nums = set(o["smask"] for o in objects.values() if o["smask"])
        for obj in sorted(objects.values(), key=lambda o: o["num"]):
            if obj["num"] in mask_nums:
                continue
            try:
                path, mode, transparent, why = export_image(pdf, objects, obj, out_dir)
                if path is None:
                    notes.append("image obj %d skipped: %s" % (obj["num"], why))
                    continue
                images.append({
                    "file": path.replace("\\", "/"),
                    "obj": obj["num"],
                    "width": obj["width"],
                    "height": obj["height"],
                    "mode": MODE_NAMES[mode],
                    "transparency": transparent,
                    "note": why,
                })
            except Exception as exc:
                notes.append("image obj %d failed: %s" % (obj["num"], exc))
    except Exception as exc:
        error = str(exc)
    payload = {"error": error, "images": images, "notes": notes}
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


if __name__ == "__main__":
    main()
