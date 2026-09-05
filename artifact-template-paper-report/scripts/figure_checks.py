"""Validate crop provenance and measure images at their actual slide size."""
import hashlib
import json
import math
import posixpath
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

NS = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def verify_crop_pixels(d, root, pdftoppm):
    """Replay the recorded PDF region; matching metadata alone cannot prove a crop."""
    require(Path(pdftoppm).is_absolute() and Path(pdftoppm).is_file(), 'Use absolute bundled pdftoppm path')
    sources = {s['id']: s for s in d['sources']}
    checked = []
    with tempfile.TemporaryDirectory(prefix='verify-crops-') as tmp:
        for asset in d['assets']:
            if 'crop' not in asset:
                continue
            c = asset['crop']
            expected = Path(tmp)/'expected'
            cmd = [str(pdftoppm), '-f', str(c['page']), '-l', str(c['page']), '-singlefile',
                   '-scale-to', str(c['scale'])]
            for flag, key in zip(('-x', '-y', '-W', '-H'), ('x', 'y', 'width', 'height')):
                cmd += [flag, str(c[key])]
            subprocess.run(cmd + ['-png', str((root/sources[asset['source']]['file']).resolve()), str(expected)],
                           check=True, capture_output=True, timeout=180)
            with Image.open(expected.with_suffix('.png')) as ref, Image.open(root/asset['file']) as actual:
                require(ref.size == actual.size and ref.convert('RGBA').tobytes() == actual.convert('RGBA').tobytes(),
                        f'{asset["id"]}: crop differs from source PDF; regenerate PNG and review')
            checked.append(asset['id'])
    return checked


def validate_crop(asset, source, root):
    if 'crop' not in asset:
        return
    c = asset['crop']
    fields = {'page', 'x', 'y', 'width', 'height', 'scale'}
    require(isinstance(c, dict) and set(c) == fields, 'crop requires page/x/y/width/height/scale')
    require(all(type(c[k]) is int for k in fields), 'crop coordinates and scale must be integers')
    require(min(c['x'], c['y']) >= 0 and min(c[k] for k in ('page', 'width', 'height', 'scale')) > 0, 'Invalid crop bounds')
    require('file' in source and Path(source['file']).suffix.lower() == '.pdf', 'Crop requires a local PDF source')
    require(c['page'] <= source['pages'], 'Crop page outside source PDF')
    file = root / asset['file']
    sidefile = file.with_suffix('.source.json')
    require(sidefile.is_file(), f'Missing crop sidecar: {sidefile.name}')
    side = json.loads(sidefile.read_text(encoding='utf-8'))
    xywh = [c[k] for k in ('x', 'y', 'width', 'height')]
    require(side.get('xywh') == xywh and side.get('pdf_page') == c['page'] and
            side.get('raster_long_edge') == c['scale'], f'{asset["id"]}: crop/sidecar mismatch; metadata does not recrop PNG')
    require(side.get('paper_sha256') == source['sha256'] and
            side.get('image_sha256') == asset['sha256'], f'{asset["id"]}: sidecar hash mismatch')
    require(isinstance(side.get('paper_file'), str) and
            (sidefile.parent / side['paper_file']).resolve() == (root / source['file']).resolve(), 'Sidecar source path mismatch')
    with Image.open(file) as im:
        require(list(im.size) == side.get('dimensions') == xywh[2:], 'Crop image dimensions mismatch')
    if 'page_dimensions' in side:
        dims = side['page_dimensions']
        require(isinstance(dims, list) and len(dims) == 2 and
                all(type(v) is int and v > 0 for v in dims), 'Invalid page_dimensions')
        require(max(dims) == c['scale'] and c['x']+c['width'] <= dims[0] and
                c['y']+c['height'] <= dims[1], 'Crop outside recorded page')
        if 'region' in side:
            region = side['region']
            require(isinstance(region, list) and len(region) == 4 and
                    all(type(v) in (int, float) and math.isfinite(v) for v in region), 'Invalid normalized region')
            x, y, w, h = region
            require(min(x, y) >= 0 and min(w, h) > 0 and x+w <= 1 and y+h <= 1, 'Normalized region outside page')
            left, top = math.floor(x*dims[0]), math.floor(y*dims[1])
            right, bottom = math.ceil((x+w)*dims[0]), math.ceil((y+h)*dims[1])
            require(xywh == [left, top, right-left, bottom-top], 'Normalized region/crop mismatch')
    require(side.get('visually_reviewed') is True, f'{asset["id"]}: crop visual review pending')


def check_picture(z, pic, relationships, asset, root, quality):
    id = asset['id']
    blip = pic.find('.//a:blip', NS)
    require(blip is not None, f'{id}: missing image data')
    rid = blip.get(REL+'embed')
    require(rid in relationships, f'{id}: missing image relation')
    rel = relationships[rid]
    require(rel.get('TargetMode') != 'External', f'{id}: linked image is not embedded')
    target = rel.get('Target', '')
    name = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('ppt/slides', target))
    require(name in z.namelist(), f'{id}: missing embedded media')
    require(hashlib.sha256(z.read(name)).hexdigest() == asset['sha256'], f'{id}: wrong image on this slide')
    rect = pic.find('.//a:srcRect', NS)
    require(rect is None or all(int(v) == 0 for v in rect.attrib.values()), f'{id}: additional PPT crop hides evidence')
    transform = pic.find('.//a:xfrm', NS)
    require(transform is not None and all(int(transform.get(k, '0')) == 0 for k in ('rot', 'flipH', 'flipV')), f'{id}: rotated/flipped evidence')
    ext = transform.find('a:ext', NS)
    require(ext is not None, f'{id}: missing image size')
    w, h = int(ext.get('cx'))/914400, int(ext.get('cy'))/914400
    require(min(w, h) > 0, f'{id}: empty image size')
    with Image.open(root / asset['file']) as raw:
        rgba = raw.convert('RGBA')
        im = Image.new('RGBA', raw.size, 'white')
        im.alpha_composite(rgba)
        im = im.convert('RGB')
    require(abs((w/h)/(im.width/im.height)-1) < 1e-5, f'{id}: nonuniform image scaling')
    channels = ImageChops.difference(im, Image.new('RGB', im.size, 'white')).split()
    mask = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    bbox = mask.point(lambda v: 255 if v > 20 else 0).getbbox()
    margins = [bbox[0], bbox[1], im.width-bbox[2], im.height-bbox[3]] if bbox else None
    ppi = min(im.width/w, im.height/h)
    label_px = asset.get('figure', {}).get('label_height_px')
    label_pt = label_px*h*72/im.height if label_px else None
    warnings = []
    if bbox is None:
        warnings.append('Image appears blank; inspect the source')
    if quality.get('min_effective_ppi', 0) > ppi:
        warnings.append('Raster resolution below the requested effective PPI')
    if quality.get('min_label_height_pt'):
        if label_pt is None:
            warnings.append('Smallest required label height unmeasured; inspect at final size')
        elif label_pt < quality['min_label_height_pt']:
            warnings.append('Required label appears smaller than the requested display height')
    return {'asset': id, 'display_inches': [round(w, 4), round(h, 4)],
            'effective_ppi': round(ppi, 1), 'label_height_pt': round(label_pt, 2) if label_pt else None,
            'margin_ltrb_px': margins, 'warnings': warnings,
            'embedding_and_aspect': 'passed', 'semantic_completeness_and_readability': 'manual review required'}
