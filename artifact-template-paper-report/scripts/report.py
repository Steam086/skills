#!/usr/bin/env python3
"""Validate the content contract, build editable PPTX, and render review candidates."""
import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from figure_checks import check_picture, positive, validate_crop, verify_crop_pixels

HERE = Path(__file__).resolve().parent
NS = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}
KINDS = {'paper', 'teaching', 'inference', 'research', 'proposal'}
BASE = {'id', 'layout', 'title', 'section', 'purpose', 'seconds', 'optional',
        'takeaway', 'footer', 'notes', 'evidence'}
EXTRA = {'cover': {'subtitle', 'authors', 'items'}, 'section': {'subtitle'},
         'bullets': {'items'}, 'comparison': {'items'}, 'flow': {'items'},
         'figure': {'figures', 'caption', 'items', 'figure_options'},
         'two-figures': {'figures', 'items', 'caption'},
         'figure-grid': {'figures', 'items', 'caption', 'columns'},
         'table': {'columns', 'rows', 'caption'}}


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def need(condition, message):
    if not condition:
        raise ValueError(message)


def keys(obj, required, optional=()):
    need(isinstance(obj, dict), 'Expected an object')
    need(set(obj) >= set(required), f'Missing fields: {set(required) - set(obj)}')
    need(set(obj) <= set(required) | set(optional), f'Unknown fields: {set(obj) - set(required) - set(optional)}')


def string(v, field, empty=False):
    need(isinstance(v, str) and (empty or bool(v.strip())), f'{field}: expected a string')


def hashed_file(obj, root):
    string(obj['file'], 'file')
    requested = Path(obj['file'])
    need(not requested.is_absolute(), 'file paths must be relative to deck.json')
    file = (root / requested).resolve()
    need(file.is_file(), f'Missing file: {file}')
    need(obj.get('sha256') == digest(file), f'Hash mismatch: {file}')
    return file


def visible(p):
    values = [p['title'], p['section'], p['footer'], p['takeaway']]
    values += [p[k] for k in ('subtitle', 'authors', 'caption') if k in p]
    for item in p.get('items', []):
        values.extend([item['heading'], item['text']])
    values.extend(p.get('columns', []))
    for row in p.get('rows', []):
        values.extend(row)
    return [s for s in values if s]


def load(file):
    d = json.loads(file.read_text(encoding='utf-8'))
    keys(d, ['schema', 'meta', 'sources', 'assets', 'slides'])
    need(d['schema'] == 'paper-report-v1', 'Unsupported schema')
    keys(d['meta'], ['title', 'audience', 'slide_language', 'notes_language', 'target_minutes'], ['presenter', 'font_face', 'figure_quality'])
    for k, v in d['meta'].items():
        if k not in ('target_minutes', 'figure_quality'):
            string(v, k)
    quality = d['meta'].get('figure_quality', {})
    keys(quality, [], ['min_effective_ppi', 'min_label_height_pt'])
    need(all(positive(v) for v in quality.values()), 'Figure quality thresholds must be positive finite numbers')
    minutes = d['meta']['target_minutes']
    need(type(minutes) in (int, float) and math.isfinite(minutes) and minutes > 0, 'Invalid target_minutes')
    for k in ('sources', 'assets', 'slides'):
        need(isinstance(d[k], list), f'{k} must be an array')
        ids = [v.get('id') for v in d[k]]
        need(all(isinstance(v, str) and re.fullmatch(r'[a-z0-9][a-z0-9-]*', v) for v in ids), f'{k}: invalid IDs')
        need(len(set(ids)) == len(ids), f'{k}: duplicate IDs')
    need(d['sources'] and d['slides'], 'Sources and slides must not be empty')
    for src in d['sources']:
        keys(src, ['id', 'title', 'type', 'version', 'collected', 'scope'], ['file', 'url', 'sha256', 'pages'])
        for k in ('title', 'type', 'version', 'collected', 'scope'):
            string(src[k], k)
        need(src.get('file') or src.get('url'), f'{src["id"]}: missing file/URL')
        if 'file' in src:
            f = hashed_file(src, file.parent)
            if f.suffix.lower() == '.pdf':
                from pypdf import PdfReader
                need(src.get('pages') == len(PdfReader(f).pages), f'{src["id"]}: PDF page count mismatch')
        if 'url' in src:
            need(isinstance(src['url'], str) and src['url'].startswith(('https://', 'http://')), 'Invalid source URL')
    sources = {s['id']: s for s in d['sources']}
    for asset in d['assets']:
        keys(asset, ['id', 'file', 'sha256', 'source', 'locator'], ['crop', 'figure'])
        need(asset['source'] in sources, 'Unknown asset source')
        string(asset['locator'], 'asset locator')
        f = hashed_file(asset, file.parent)
        need(f.read_bytes()[:8] == b'\x89PNG\r\n\x1a\n', 'v1 assets must be PNG')
        validate_crop(asset, sources[asset['source']], file.parent)
        if 'figure' in asset:
            fig = asset['figure']
            keys(fig, ['parent', 'required_elements'], ['panel', 'shared_context', 'label_height_px'])
            string(fig['parent'], 'parent figure locator')
            for key in ('panel', 'shared_context'):
                if key in fig:
                    string(fig[key], key)
            need(isinstance(fig['required_elements'], list) and fig['required_elements'], 'List the required evidence elements')
            for element in fig['required_elements']:
                string(element, 'required figure element')
            if 'label_height_px' in fig:
                need(positive(fig['label_height_px']), 'Invalid measured label height')
    assets = {a['id']: a for a in d['assets']}
    for i, p in enumerate(d['slides'], 1):
        need(p.get('layout') in EXTRA, f'Slide {i}: unsupported layout')
        layout = p['layout']
        keys(p, BASE, EXTRA[layout])
        for k in ('id', 'title', 'section', 'purpose', 'footer', 'notes'):
            string(p[k], f'{i}/{k}')
        string(p['takeaway'], 'takeaway', empty=True)
        need(type(p['optional']) is bool, 'optional must be boolean')
        need(type(p['seconds']) in (int, float) and math.isfinite(p['seconds']) and p['seconds'] > 0, 'Invalid seconds')
        need(isinstance(p['evidence'], list) and p['evidence'], f'{i}: missing evidence')
        for e in p['evidence']:
            keys(e, ['source', 'locator', 'kind', 'claim', 'limits'])
            need(e['source'] in sources and e['kind'] in KINDS, f'{i}: invalid evidence reference/kind')
            for k in ('locator', 'claim', 'limits'):
                string(e[k], k, empty=k == 'limits')
        if layout in ('cover', 'section'):
            string(p.get('subtitle'), 'subtitle')
            need(not p['takeaway'], 'Cover/section takeaway must be empty; put content in subtitle')
        if layout == 'cover':
            string(p.get('authors'), 'authors', empty=True)
        if layout in ('bullets', 'comparison', 'flow', 'two-figures'):
            need('items' in p, 'Missing items')
        if 'items' in p:
            lo, hi = {'cover': (1, 3), 'bullets': (1, 6), 'comparison': (2, 3),
                      'flow': (2, 5), 'figure': (1, 3), 'two-figures': (2, 2), 'figure-grid': (2, 4)}[layout]
            need(isinstance(p['items'], list) and lo <= len(p['items']) <= hi, 'Invalid item count')
            for item in p['items']:
                keys(item, ['heading', 'text'])
                string(item['heading'], 'item heading')
                string(item['text'], 'item text')
        if layout in ('figure', 'two-figures', 'figure-grid'):
            lo, hi = {'figure': (1, 1), 'two-figures': (2, 2), 'figure-grid': (2, 4)}[layout]
            need(isinstance(p.get('figures'), list) and lo <= len(p['figures']) <= hi, 'Invalid figure count')
            need(all(id in assets for id in p['figures']), 'Missing figure asset')
            cited = {e['source'] for e in p['evidence']}
            need(all(assets[id]['source'] in cited for id in p['figures']), 'Figure source missing from slide evidence')
        if layout == 'figure':
            string(p.get('caption'), 'caption')
            opt = p.get('figure_options', {})
            keys(opt, [], ['placement', 'height', 'align'])
            need(opt.get('placement', 'side') in ('side', 'wide'), 'Invalid figure placement')
            need(opt.get('align', 'top') in ('top', 'center'), 'Invalid figure alignment')
            maximum = 3.1 if opt.get('placement') == 'wide' and p.get('items') else 4.7
            need(positive(opt.get('height', maximum)) and opt.get('height', maximum) <= maximum, 'Figure height exceeds available body region')
        if layout == 'figure-grid':
            cols = p.get('columns', 2 if len(p['figures']) == 4 else len(p['figures']))
            need(type(cols) is int and 2 <= cols <= 3 and cols <= len(p['figures']), 'Grid columns must be 2 or 3')
            need(len(p['figures']) <= cols*2, 'Grid needs more than two rows')
            need('items' not in p or len(p['items']) == len(p['figures']), 'Grid explanations must match figures in order')
        if 'caption' in p:
            string(p['caption'], 'caption', empty=True)
        if layout == 'table':
            need(isinstance(p.get('columns'), list) and 2 <= len(p['columns']) <= 5, 'Invalid columns')
            need(isinstance(p.get('rows'), list) and 1 <= len(p['rows']) <= 6, 'Invalid rows')
            for row in [p['columns']] + p['rows']:
                need(isinstance(row, list) and len(row) == len(p['columns']), 'Table width mismatch')
                for v in row:
                    string(v, 'cell', empty=True)
        notes = [p['title'], '', p['purpose'], '', p['notes'], '', '来源与证据限定']
        for id in p.get('figures', []):
            fig = assets[id].get('figure')
            if fig:
                notes.append(f'配图: {fig["parent"]}' + (f' / {fig["panel"]}' if fig.get('panel') else ''))
                if fig.get('shared_context'):
                    notes.append(fig['shared_context'])
        for e in p['evidence']:
            src = sources[e['source']]
            notes.append(f'[{e["kind"]}] {e["claim"]}\n{src["title"]}; {src.get("url") or src.get("file")}; {e["locator"]}; version: {src["version"]}; collected: {src["collected"]}\n适用范围: {src["scope"]}\n限定: {e["limits"] or "无额外限定"}')
        p['_notes'] = '\n'.join(notes)
    return d


def normalized(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s))


def check(d, deck, pptx, pdf=None):
    records = []
    with ZipFile(pptx) as z:
        names = set(z.namelist())
        need(len([n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)]) == len(d['slides']), 'PPTX page count mismatch')
        size = ET.fromstring(z.read('ppt/presentation.xml')).find('p:sldSz', NS)
        width, height = int(size.get('cx')), int(size.get('cy'))
        need(abs(width/914400-13.333) < .001 and abs(height/914400-7.5) < .001, 'Wrong slide dimensions')
        assets = {a['id']: a for a in d['assets']}
        for i, p in enumerate(d['slides'], 1):
            root = ET.fromstring(z.read(f'ppt/slides/slide{i}.xml'))
            pics = root.findall('.//p:pic', NS)
            ids = p.get('figures', [])
            need(len(pics) == len(ids), f'Slide {i}: image count mismatch')
            images = []
            if ids:
                rels = ET.fromstring(z.read(f'ppt/slides/_rels/slide{i}.xml.rels'))
                relationships = {r.get('Id'): r for r in rels}
                for pic, id in zip(pics, ids):
                    images.append(check_picture(z, pic, relationships, assets[id], deck.parent, d['meta'].get('figure_quality', {})))
            texts = [n.text or '' for n in root.findall('.//a:t', NS)]
            joined = normalized('\n'.join(texts))
            for value in visible(p):
                need(normalized(value) in joined, f'Slide {i}: missing visible content: {value[:65]}')
            nr = ET.fromstring(z.read(f'ppt/notesSlides/notesSlide{i}.xml'))
            body = [sp for sp in nr.findall('.//p:sp', NS) if sp.find('.//p:ph[@type="body"]', NS) is not None]
            notes = '\n'.join(n.text or '' for sp in body for n in sp.findall('.//a:t', NS))
            need(notes == p['_notes'], f'Slide {i}: full notes mismatch')
            for x in root.findall('.//a:xfrm', NS):
                off, ext = x.find('a:off', NS), x.find('a:ext', NS)
                if off is None or ext is None:
                    continue
                px, py, w, h = [int(v) for v in [off.get('x'), off.get('y'), ext.get('cx'), ext.get('cy')]]
                tol = .025 * 914400
                need(min(px, py, w, h) >= -tol and px+w <= width+tol and py+h <= height+tol, f'Slide {i}: off-slide object')
            records.append({'slide': i, 'id': p['id'], 'title': p['title'], 'notes_match': True,
                            'native_tables': len(root.findall('.//a:tbl', NS)), 'images': images})
    if pdf:
        from pypdf import PdfReader
        pages = PdfReader(pdf).pages
        need(len(pages) == len(d['slides']), 'PDF page count mismatch')
        for i, (page, p) in enumerate(zip(pages, d['slides']), 1):
            text = page.extract_text() or ''
            for v in visible(p):
                need(normalized(v) in normalized(text), f'PDF {i}: missing/clipped text: {v[:65]}')
            need(any(normalized(p['title']) in normalized(line) for line in text.splitlines()), f'PDF {i}: title wrapped or missing')
    return {'schema': 'paper-report-check-v1', 'deck_sha256': digest(deck), 'pptx_sha256': digest(pptx),
            'pdf_sha256': digest(pdf) if pdf else None, 'pages': records,
            'structural_check': 'passed', 'visual_review': 'pending'}


def write_json(file, data):
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n',
                    encoding='utf-8')


def new_dir(out):
    need(not out.exists(), f'Output already exists; choose a new version: {out}')
    out.mkdir(parents=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['validate', 'outline', 'build', 'check', 'render'])
    parser.add_argument('--deck', type=Path, required=True)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--pptx', type=Path)
    parser.add_argument('--pdf', type=Path)
    parser.add_argument('--node')
    parser.add_argument('--node-modules')
    parser.add_argument('--soffice')
    parser.add_argument('--pdftoppm')
    a = parser.parse_args()
    deck = a.deck.resolve()
    d = load(deck)
    total = sum(p['seconds'] for p in d['slides']) / 60
    print(f'Contract valid: {len(d["slides"])} slides, planned {total:.1f} min; target {d["meta"]["target_minutes"]} min')
    if abs(total-d['meta']['target_minutes']) > max(2, .15*d['meta']['target_minutes']):
        print('WARNING: review time budget against target')
    if a.mode == 'validate':
        return
    if a.mode == 'check':
        need(a.pptx, 'Supply --pptx')
        result = check(d, deck, a.pptx.resolve(), a.pdf.resolve() if a.pdf else None)
        if a.pdftoppm:
            result['source_crops_replayed'] = verify_crop_pixels(d, deck.parent, a.pdftoppm)
        print(json.dumps(result, ensure_ascii=False))
        return
    need(a.out, 'Supply --out')
    out = a.out.resolve()
    if a.mode == 'outline':
        new_dir(out)
        outline = [f'# {d["meta"]["title"]}', '', f'来源：deck.json SHA-256 `{digest(deck)}`；先合回 JSON 再修改此视图。', '']
        manuscript = [f'# {d["meta"]["title"]}：逐页讲稿', '']
        for i, p in enumerate(d['slides'], 1):
            outline += [f'### 第 {i} 页：{p["title"]}', '', f'ID: {p["id"]}；版式: {p["layout"]}；预算: {p["seconds"]}s；可选: {p["optional"]}', '', p['purpose'], '', '可见内容：', '']
            outline += [f'- {v}' for v in visible(p)]
            outline += ['', ('配图: ' + ', '.join(p.get('figures', []))).rstrip(), '', '证据：']
            outline += [f'- [{e["kind"]}] {e["source"]} / {e["locator"]}: {e["claim"]}；限定: {e["limits"]}' for e in p['evidence']]
            outline += ['']
            manuscript += [f'### 第 {i} 页：{p["title"]}', '', p['_notes'], '']
        (out/'outline.md').write_text('\n'.join(outline), encoding='utf-8')
        (out/'manuscript.md').write_text('\n'.join(manuscript), encoding='utf-8')
        return
    if a.mode == 'build':
        need(a.node and a.node_modules, 'Supply --node and --node-modules from runtime loader')
        new_dir(out)
        for asset in d['assets']:
            asset['file'] = str((deck.parent/asset['file']).resolve())
        env = dict(os.environ, NODE_PATH=str(Path(a.node_modules).resolve()))
        with tempfile.TemporaryDirectory(prefix='paper-report-build-') as temp:
            prepared = Path(temp)/'prepared.json'
            write_json(prepared, d)
            subprocess.run([a.node, str(HERE/'build.cjs'), str(prepared),
                            str(out/'report.pptx')], env=env, check=True,
                           timeout=120)
        result = check(d, deck, out/'report.pptx')
        result['node'] = subprocess.check_output(
            [a.node, '--version'], text=True, encoding='utf-8',
            errors='replace').strip()
        write_json(out/'check.json', result)
        return
    need(a.pptx and a.soffice and a.pdftoppm, 'Supply --pptx, --soffice, --pdftoppm')
    pptx = a.pptx.resolve()
    check(d, deck, pptx)
    source_crops = verify_crop_pixels(d, deck.parent, a.pdftoppm)
    need(Path(a.soffice).is_absolute() and Path(a.soffice).is_file(), 'Use absolute bundled soffice path')
    new_dir(out)
    with tempfile.TemporaryDirectory(prefix='paper-report-') as temp:
        temp = Path(temp)
        subprocess.run([a.soffice, '-env:UserInstallation='+(temp/'profile').as_uri(), '--headless', '--convert-to', 'pdf', '--outdir', str(temp), str(pptx)], check=True, timeout=120)
        pdf = temp/(pptx.stem+'.pdf')
        need(pdf.is_file() and pdf.stat().st_size > 0, 'LibreOffice did not create a PDF')
        shutil.copy2(pdf, out/'report.pdf')
    result = check(d, deck, pptx, out/'report.pdf')
    result['source_crops_replayed'] = source_crops
    subprocess.run([a.pdftoppm, '-scale-to', '1600', '-png', str(out/'report.pdf'), str(out/'slide')], check=True, timeout=180)
    images = sorted(out.glob('slide-*.png'))
    need(len(images) == len(d['slides']), 'PNG page count mismatch')
    from PIL import Image, ImageDraw
    for start in range(0, len(images), 9):
        group = images[start:start+9]
        sheet = Image.new('RGB', (1800, 365*((len(group)+2)//3)), '#dbe2e8')
        draw = ImageDraw.Draw(sheet)
        for j, file in enumerate(group):
            with Image.open(file) as im:
                im.thumbnail((592, 333))
                x, y = (j%3)*600+4, (j//3)*365+25
                sheet.paste(im, (x, y)); draw.text((x+8, y-20), str(start+j+1), fill='#173a5e')
        sheet.save(out/f'contact-{start+1:02}.png')
    result['renderer'] = subprocess.check_output(
        [a.soffice, '--version'], text=True, encoding='utf-8',
        errors='replace').strip()
    write_json(out/'check.json', result)
    print(f'Rendered {len(images)} pages; visual review pending: {out}')


if __name__ == '__main__':
    main()
