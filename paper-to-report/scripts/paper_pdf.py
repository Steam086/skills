#!/usr/bin/env python3
"""Inspect or rasterize a paper; coordinates refer to the chosen full-page raster."""
import argparse
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import tempfile
from pathlib import Path


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def run(command):
    result = subprocess.run(command, text=True, encoding='utf-8',
                            errors='replace', capture_output=True,
                            timeout=120)
    if result.returncode:
        detail = result.stderr.strip()[-2000:]
        raise RuntimeError(f'{Path(command[0]).name} failed: {detail}')
    return result.stdout


def recorded_path(file, base):
    """Record a relocatable path without disclosing the machine's absolute path."""
    try:
        return Path(os.path.relpath(file, base)).as_posix()
    except ValueError:
        return file.name


def object_inventory(pdf, number):
    """Resource inventory only: a Form's local BBox is not a page-space crop."""
    from pypdf import PdfReader
    reader = PdfReader(pdf)
    if not 1 <= number <= len(reader.pages):
        raise ValueError('Page outside PDF')
    page = reader.pages[number-1]
    objects, seen = [], set()

    def walk(resources, path, depth):
        if not resources:
            return
        xobjects = resources.get_object().get('/XObject', {})
        if hasattr(xobjects, 'get_object'):
            xobjects = xobjects.get_object()
        for name, ref in xobjects.items():
            obj = ref.get_object()
            key = (getattr(ref, 'idnum', None), getattr(ref, 'generation', None)) if hasattr(ref, 'idnum') else id(obj)
            record = {'resource_path': path+str(name), 'type': str(obj.get('/Subtype'))}
            if obj.get('/BBox'):
                record['local_bbox'] = [float(v) for v in obj['/BBox']]
            if obj.get('/Matrix'):
                record['local_matrix'] = [float(v) for v in obj['/Matrix']]
            if obj.get('/Subtype') == '/Image':
                record['pixel_dimensions'] = [int(obj['/Width']), int(obj['/Height'])]
            record['already_seen'] = key in seen
            objects.append(record)
            if key not in seen and depth < 16:
                seen.add(key)
                walk(obj.get('/Resources'), path+str(name)+'/', depth+1)

    walk(page.get('/Resources'), '', 0)
    return {'pdf_page': number, 'media_box': [float(v) for v in page.mediabox],
            'rotation': page.rotation, 'objects': objects,
            'interpretation': 'Resources are clues, not semantic panels or a count of drawn instances. Forms may be nested/reused; page text, paths and external panel labels may lie outside them. local_bbox is not a page crop. Inspect the rendered full page.'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['inspect', 'objects', 'page', 'crop'])
    p.add_argument('--pdf', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--pdfinfo', default='pdfinfo')
    p.add_argument('--pdftotext', default='pdftotext')
    p.add_argument('--pdftoppm', default='pdftoppm')
    p.add_argument('--page', type=int)
    p.add_argument('--scale', type=int)
    region = p.add_mutually_exclusive_group()
    region.add_argument('--xywh', type=int, nargs=4)
    region.add_argument('--region', type=float, nargs=4, help='x/y/width/height fractions of the displayed full MediaBox page, top-left origin')
    p.add_argument('--width-in', type=float, help='Target displayed image width; requires --region and --ppi')
    p.add_argument('--ppi', type=float, help='Requested raster pixels per displayed inch; does not enlarge text on a slide')
    p.add_argument('--sha256')
    a = p.parse_args()
    pdf, out = a.pdf.resolve(), a.out.resolve()
    digest = sha(pdf)
    if a.mode == 'inspect':
        if out.exists():
            raise ValueError('Use a new inspection directory')
        info = run([a.pdfinfo, str(pdf)])
        match = re.search(r'^Pages:\s+(\d+)', info, re.M)
        if not match:
            raise ValueError('Cannot determine page count')
        out.mkdir(parents=True)
        count = int(match[1])
        run([a.pdftotext, '-layout', str(pdf), str(out / 'paper.txt')])
        text = (out / 'paper.txt').read_text(encoding='utf-8', errors='replace')
        pages = text.split('\f')
        for i in range(count):
            body = pages[i] if i < len(pages) else ''
            (out / f'page-{i+1:03}.txt').write_text(body, encoding='utf-8')
        (out / 'source.json').write_text(json.dumps({
            'file': recorded_path(pdf, out), 'sha256': digest, 'pages': count,
            'pdfinfo': info, 'page_numbering': '1-based PDF pages including cover',
            'text_is_not_visual_review': True,
        }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'Extracted {count} pages; inspect figures visually: {out}')
        return
    if not a.page or a.page < 1:
        raise ValueError('A positive --page is required')
    if a.mode == 'objects':
        if out.exists() or out.suffix.lower() != '.json':
            raise ValueError('Use a new .json output filename')
        result = object_inventory(pdf, a.page)
        result.update(paper_file=recorded_path(pdf, out.parent), paper_sha256=digest)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        print(out)
        return
    if a.scale is not None and a.scale < 1:
        raise ValueError('Scale must be positive')
    if a.mode != 'crop' and any(v is not None for v in (a.xywh, a.region, a.width_in, a.ppi)):
        raise ValueError('Region and target display size apply only to crop')
    target = a.width_in is not None or a.ppi is not None
    if target and (a.region is None or a.width_in is None or a.ppi is None or a.scale is not None):
        raise ValueError('Adaptive rasterization requires --region, --width-in and --ppi, without --scale')
    if target and not all(math.isfinite(v) and v > 0 for v in (a.width_in, a.ppi)):
        raise ValueError('Target width and PPI must be positive finite numbers')
    if a.region is not None:
        x, y, w, h = a.region
        if not all(math.isfinite(v) for v in a.region) or min(x, y) < 0 or min(w, h) <= 0 or x+w > 1 or y+h > 1:
            raise ValueError('Normalized region must fit inside [0,1] x [0,1]')
    if target:
        from pypdf import PdfReader
        pages = PdfReader(pdf).pages
        if a.page > len(pages):
            raise ValueError('Page outside PDF')
        page = pages[a.page-1]
        w, h = float(page.mediabox.width), float(page.mediabox.height)
        if page.rotation % 180:
            w, h = h, w
        a.scale = math.ceil(a.width_in*a.ppi/a.region[2]*max(w, h)/w)
    a.scale = a.scale or 2200
    if out.exists() or out.with_suffix('.source.json').exists():
        raise ValueError('Output already exists; use a new filename')
    if out.suffix.lower() != '.png':
        raise ValueError('Output must end in .png')
    if a.mode == 'crop':
        if a.sha256 != digest:
            raise ValueError('PDF SHA-256 mismatch or missing reviewed --sha256')
        if a.region is None and (not a.xywh or min(a.xywh[:2]) < 0 or min(a.xywh[2:]) <= 0):
            raise ValueError('Supply nonnegative x/y and positive width/height')
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [a.pdftoppm, '-f', str(a.page), '-l', str(a.page), '-singlefile',
           '-scale-to', str(a.scale)]
    if a.mode == 'crop' and a.region is None:
        for flag, value in zip(['-x', '-y', '-W', '-H'], a.xywh):
            cmd.extend([flag, str(value)])
    page_dimensions = None
    if a.region is not None:
        from PIL import Image
        with tempfile.TemporaryDirectory(prefix='paper-crop-') as temp:
            base = Path(temp)/'page'
            run(cmd + ['-png', str(pdf), str(base)])
            with Image.open(base.with_suffix('.png')) as im:
                page_dimensions = list(im.size)
                x, y, w, h = a.region
                left, top = math.floor(x*im.width), math.floor(y*im.height)
                right, bottom = math.ceil((x+w)*im.width), math.ceil((y+h)*im.height)
                a.xywh = [left, top, right-left, bottom-top]
                im.crop((left, top, right, bottom)).save(out)
    else:
        run(cmd + ['-png', str(pdf), str(out.with_suffix(''))])
    data = out.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Renderer did not produce a PNG')
    dimensions = struct.unpack('>II', data[16:24])
    if a.mode == 'crop' and tuple(a.xywh[2:]) != dimensions:
        out.unlink()
        raise ValueError('Crop extends outside the page; inspect coordinates')
    metadata = {
        'paper_file': recorded_path(pdf, out.parent),
        'paper_sha256': digest, 'pdf_page': a.page,
        'raster_long_edge': a.scale, 'xywh': a.xywh if a.mode == 'crop' else None,
        'image_sha256': sha(out), 'dimensions': dimensions, 'visually_reviewed': False,
    }
    if a.region is not None:
        metadata.update(region=a.region, page_dimensions=page_dimensions)
    if target:
        metadata.update(target_width_in=a.width_in, target_ppi=a.ppi)
    out.with_suffix('.source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(out)


if __name__ == '__main__':
    main()
