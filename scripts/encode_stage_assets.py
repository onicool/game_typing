"""Deterministic WebP copies; preserve PNG source bytes, size and alpha.

Pillow is an optional authoring tool, not an app/build dependency.
Usage: python scripts/encode_stage_assets.py [output directory]
The default emits public/stages/*.webp without modifying the PNGs.
"""
import hashlib
import io
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, features

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'public/stages'
OUT.mkdir(parents=True,exist_ok=True)
OPTIONS={'quality':92,'method':6,'exact':True}
rows=[]
for name in ['skyway','aether-sentinel']:
 source=ROOT/'public/stages'/f'{name}.png';original=source.read_bytes()
 with Image.open(source) as image:
  encoded=[]
  for _ in range(2):
   stream=io.BytesIO();image.save(stream,format='WEBP',**OPTIONS);encoded.append(stream.getvalue())
  assert encoded[0]==encoded[1], 'Encoder outputs differed with identical settings'
  decoded=Image.open(io.BytesIO(encoded[0])).convert(image.mode)
  assert decoded.size==image.size
  alpha_same=image.mode!='RGBA' or ImageChops.difference(image.getchannel('A'),decoded.getchannel('A')).getbbox() is None
  assert alpha_same, 'Transparency changed'
  target=OUT/f'{name}.webp';target.write_bytes(encoded[0])
  assert source.read_bytes()==original, 'PNG source changed'
  rows.append({'name':name,'source_bytes':len(original),'webp_bytes':len(encoded[0]),'size':image.size,
   'alpha_exact':alpha_same,'repeat_bytes_exact':True,'source_sha256':hashlib.sha256(original).hexdigest(),
   'webp_sha256':hashlib.sha256(encoded[0]).hexdigest()})
print(json.dumps({'libwebp':features.version('webp'),'options':OPTIONS,'lossless_rgb':False,'rows':rows},indent=2))
