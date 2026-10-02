#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ICEBREAKER concept screens. Standard library only; writes beside this script."""
from pathlib import Path
import math
import random

OUT = Path(__file__).resolve().parent
CYAN = '#65f5ed'
PINK = '#ff58c8'
GREEN = '#9af2bd'
RED = '#ff6377'

CSS = r'''
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#03070b}
body{font-family:Menlo,Consolas,"Hiragino Kaku Gothic ProN","Hiragino Sans",monospace;color:#e4eef1;-webkit-font-smoothing:antialiased}
.screen{position:relative;width:1920px;height:1080px;overflow:hidden;background:#03070b}
.scene{position:absolute;inset:0;width:100%;height:100%}.mono{font-family:Menlo,Consolas,monospace}.jp{font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans",sans-serif}
.eyebrow{font-size:12px;letter-spacing:2px;color:#718992;text-transform:uppercase}.cyan{color:#65f5ed}.green{color:#9af2bd}.pink{color:#ff58c8}.red{color:#ff6377}.muted{color:#718992}
.wordmark{font-family:"Avenir Next Condensed","Arial Narrow",sans-serif;font-weight:800;font-size:32px;letter-spacing:3px;line-height:1}.brand{display:flex;align-items:center;gap:15px}.brand-icon{width:38px;height:38px}
.topbar{position:absolute;top:40px;left:56px;right:56px;height:60px;display:flex;align-items:center;justify-content:space-between}.brand-sub{font-size:10px;color:#718992;letter-spacing:2.5px;margin-top:9px}.top-center{position:absolute;left:50%;transform:translateX(-50%);text-align:center}.sector{letter-spacing:4px;font-size:15px}.sector em{font-style:normal;color:#65f5ed}.sector-sub{font-size:10px;color:#657982;letter-spacing:2px;margin-top:12px}.topline{position:absolute;top:118px;left:56px;right:56px;height:1px;background:linear-gradient(90deg,#24454c,transparent 32%,transparent 65%,#24454c)}
.trace{width:262px}.trace-label{display:flex;justify-content:space-between;align-items:center;font-size:12px;letter-spacing:2px;color:#efab72}.trace-label b{font-size:25px;font-weight:400;letter-spacing:0}.trace-track{display:flex;gap:4px;margin-top:10px;height:5px}.trace-track i{display:block;flex:1;background:#2d2123}.trace-track i.on{background:#ff9876}.trace-note{font-size:9px;letter-spacing:1px;text-align:right;color:#8c6764;margin-top:8px}
.chain{position:absolute;left:74px;top:237px}.chain .label{font-size:13px;letter-spacing:4px;color:#96afb7}.chain .number{font-family:"Avenir Next Condensed",sans-serif;font-size:99px;font-weight:600;line-height:1.06;letter-spacing:1px;margin:12px 0 0}.chain .caption{font-size:10px;letter-spacing:2px;color:#65f5ed;margin-top:8px}.overclock{margin-top:44px}.stages{display:flex;gap:7px;margin:15px 0 12px}.stages i{width:49px;height:7px;background:#152831;display:block;transform:skewX(-25deg)}.stages i.active{background:#65f5ed;box-shadow:0 0 13px #65f5ed55}.stages i.last{background:#ff58c8;box-shadow:0 0 13px #ff58c866}.depth{position:absolute;left:75px;bottom:152px;display:flex;gap:17px;align-items:center}.depth .ruler{height:113px;width:15px;background:repeating-linear-gradient(0deg,#33515a 0 1px,transparent 1px 10px);border-left:1px solid #41646e}.depth-value{font-size:30px;margin-top:9px}.depth-value small{font-size:12px;color:#7c929a}.depth-tiny{font-size:10px;letter-spacing:1px;color:#718992;margin-top:12px}
.enemy-info{position:absolute;top:371px;right:73px;width:236px}.enemy-info .id{font-size:11px;letter-spacing:1px;color:#657c87}.enemy-info h2{font-size:20px;letter-spacing:3px;font-weight:400;margin:14px 0 10px}.enemy-info .kind{font-size:12px;color:#80959d}.integrity{margin-top:27px;font-size:10px;letter-spacing:1px;display:flex;justify-content:space-between}.integrity-line{height:3px;background:#22313a;margin:11px 0 25px}.integrity-line i{display:block;background:#ff58c8;height:3px;width:38%}.enemy-log{font-size:10px;line-height:2.2;color:#6d8993}.enemy-log .active{color:#65f5ed}.ice-index{position:absolute;left:50%;top:671px;transform:translateX(-50%);display:flex;gap:30px;align-items:center;font-size:10px;letter-spacing:2px;color:#719399}.ice-index .pill{border:1px solid #284b51;padding:7px 10px;color:#9ab9c1}
.input-panel{position:absolute;left:480px;top:754px;width:960px;height:252px;background:#080f16;border:1px solid #375963;z-index:10;padding:25px 36px;text-shadow:none;filter:none;box-shadow:0 12px 60px #000b}
.input-panel:before,.input-panel:after{content:"";position:absolute;width:32px;height:15px;border-color:#65f5ed;border-style:solid;pointer-events:none}.input-panel:before{top:-1px;left:-1px;border-width:2px 0 0 2px}.input-panel:after{bottom:-1px;right:-1px;border-width:0 2px 2px 0}
.input-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:1.4px;color:#94a8b0}.input-label{color:#65f5ed}.next{font-size:11px;letter-spacing:.4px;color:#74818b}.next .jp{font-size:13px;margin:0 9px;color:#8f9ba4}.input-body{text-align:center;margin-top:17px}.word{font-size:43px;font-weight:600;line-height:1.35;letter-spacing:6px;color:#edf4f5;text-shadow:none;filter:none}.reading{font-size:16px;letter-spacing:3px;color:#aab8c1;margin-top:6px;text-shadow:none;filter:none}.romaji{font-size:34px;letter-spacing:3px;line-height:1.3;margin-top:12px;white-space:nowrap;color:#e2e9ed;text-shadow:none;filter:none}.typed{color:#9af2bd;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:8px}.cursor{display:inline-block;border-left:2px solid #b3c8cf;height:32px;vertical-align:-5px;margin-right:-2px}.input-meta{position:absolute;bottom:21px;left:36px;right:36px;display:flex;justify-content:space-between;font-size:9px;letter-spacing:1.5px;color:#78919c}.input-meta .progress{display:flex;align-items:center;gap:10px}.microtrack{width:76px;height:2px;background:#29434b}.microtrack i{width:50%;display:block;height:2px;background:#9af2bd}
.footer{position:absolute;bottom:29px;left:56px;right:56px;display:flex;justify-content:space-between;font-size:10px;letter-spacing:1px;color:#59737f}.footer .center{position:absolute;left:50%;transform:translateX(-50%)}.footer kbd{border:1px solid #2c434e;padding:3px 6px;margin-right:6px;color:#9aadb5}.signal{color:#65f5ed;font-size:9px;letter-spacing:2px}.critical{position:absolute;left:1125px;top:386px;color:#fff0c7;font-size:14px;letter-spacing:3px;transform:rotate(-5deg)}.critical small{display:block;font-size:9px;letter-spacing:2px;color:#8fa3a7;margin-top:8px}
.boss .input-panel{border-color:#ef5e75;box-shadow:0 0 26px #ff476223,0 12px 60px #000b}.boss .input-panel:before,.boss .input-panel:after{border-color:#ff6377}.boss .input-label{color:#ff8999}.boss .input-body{margin-top:28px}.boss .word{font-size:40px}.boss .romaji{margin-top:16px}.boss .trace-label{color:#ff6377}.boss .trace-track i.on{background:#ff6377}.telegraph{position:absolute;left:390px;top:155px;width:1140px;height:66px;border:1px solid #894356;background:#160e17;display:flex;justify-content:center;align-items:center;gap:20px;z-index:2;font-size:19px;letter-spacing:1px}.telegraph .warn{color:#ff6377;font-size:22px}.telegraph .message{font-size:18px}.telegraph .message strong{color:#ff92ac;font-family:Menlo,monospace;font-size:16px;font-weight:400}.counter-timer{position:absolute;right:73px;top:680px;width:236px;font-size:10px;letter-spacing:2px;color:#ff8999}.counter-timer b{font-size:36px;font-weight:400;display:block;margin:12px 0 14px}.counter-timer .timebar{height:3px;background:#301c29}.counter-timer .timebar i{width:62%;height:3px;background:#ff6377;display:block}
/* Reports use flat, crisp content layers; bloom belongs only to decorative SVG. */
.report{background:radial-gradient(ellipse at 15% 0%,#10212b66,transparent 55%),#060a10}.report .topbar{top:31px;height:51px}.report .topline{top:105px;background:#1b2d37}.nav{display:flex;gap:41px;font-size:11px;letter-spacing:2px;color:#758b95}.nav .selected{color:#65f5ed;position:relative}.nav .selected:after{content:"";position:absolute;left:0;right:0;bottom:-29px;height:2px;background:#65f5ed}.session{font-size:10px;letter-spacing:1px;color:#80939c}.report-heading{position:absolute;left:64px;top:148px}.report-heading h1{font-size:36px;letter-spacing:4px;margin:11px 0 0;font-weight:500}.report-heading .heading-inline{font-size:12px;color:#768f9a;margin-left:22px;letter-spacing:1px}.report-summary{position:absolute;top:156px;right:65px;display:flex;gap:41px}.report-summary .value{font-size:33px;font-weight:400;margin-top:9px}.report-summary .value small{font-size:12px;color:#718992}.panel{position:absolute;border:1px solid #253944;background:#0b121b}.panel:before{content:"";position:absolute;top:-1px;left:-1px;width:20px;height:8px;border-left:2px solid #45616d;border-top:2px solid #45616d}.panel-head{height:63px;border-bottom:1px solid #1d303b;display:flex;justify-content:space-between;align-items:center;padding:0 25px;font-size:12px;letter-spacing:1px}.panel-head .heading{color:#d1dfe5}.panel-head .index{color:#5f8795;font-size:10px;margin-right:14px}.toggle{display:flex;font-size:10px;color:#778b94;gap:2px;letter-spacing:0}.toggle span{padding:8px 13px}.toggle .on{background:#173438;color:#83ece5;border:1px solid #31585c}.keyboard-panel{left:64px;top:260px;width:1096px;height:369px}.keyboard{position:absolute;left:25px;top:93px;width:1044px}.keyrow{display:flex;gap:6px;margin-bottom:6px}.key{height:39px;flex-shrink:0;background:#132630;border:1px solid #28424d;border-radius:3px;display:flex;justify-content:space-between;align-items:center;padding:0 10px;position:relative}.key .mainkey{font-size:13px;color:#b4c8d2}.key .subkey{font-size:9px;color:#68828e}.key.warm{background:#4a3428;border-color:#835b3b}.key.warm .mainkey{color:#f7c592}.key.hot{background:#7b394e;border-color:#e4778f}.key.hot .mainkey{color:#ffe0e6}.key.critical-key{background:#9c3a59;border-color:#ff81a1}.key.critical-key .mainkey{color:#fff1f5}.key .homeline{position:absolute;bottom:5px;left:12px;right:12px;height:1px;background:#537784}.heatmap-caption{position:absolute;bottom:19px;left:26px;right:26px;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#81949e}.legend{display:flex;gap:10px;align-items:center}.legend-strip{display:flex;gap:3px}.legend-strip i{width:20px;height:7px;display:block}.matrix-panel{left:1184px;top:260px;width:672px;height:369px}.matrix-svg{position:absolute;left:24px;top:84px;width:337px;height:248px}.matrix-callout{position:absolute;left:387px;top:102px;right:23px}.matrix-callout h2{font-size:37px;font-weight:400;letter-spacing:1px;margin:14px 0;color:#ff94ae}.matrix-callout .matrix-stat{font-size:13px;color:#c4d1d9;line-height:1.9}.matrix-note{font-size:12px;line-height:2;color:#7e96a1;margin-top:24px}.matrix-foot{position:absolute;left:26px;bottom:19px;font-size:10px;color:#728993;letter-spacing:.4px}.vulns-panel{left:64px;top:652px;width:1096px;height:354px}.table{padding:0 24px}.table-head,.vuln-row{display:grid;grid-template-columns:132px 278px 118px 225px 1fr;align-items:center;gap:0}.table-head{height:39px;color:#647d8b;font-size:9px;letter-spacing:1px}.vuln-row{height:58px;border-top:1px solid #1d2c36;font-size:12px}.vuln-row .identifier{color:#95b0bd;font-size:11px}.vuln-row .description{font-size:14px;color:#d6e1e7}.vuln-row .description strong{font-family:Menlo,monospace;font-weight:400;margin-right:9px}.severity{font-size:10px;letter-spacing:1px}.severity.high{color:#ff8d9c}.severity.med{color:#eabb81}.impact{color:#c5d1d6;font-size:13px}.impact small{font-size:10px;color:#76909c;margin-left:4px}.patch{display:inline-flex;justify-content:center;align-items:center;height:32px;width:151px;border:1px solid #30565f;color:#9eb8c5;font-family:inherit;background:#101e29;font-size:11px;letter-spacing:.3px}.patch.primary{background:#9af2bd;color:#0a2522;border-color:#9af2bd;font-weight:600}.patched-row .description{text-decoration:line-through;text-decoration-color:#68947b;color:#78a58f}.patched-row .identifier{color:#618d7b}.patched-row .impact{color:#638d79}.patched-row .severity{color:#9af2bd}.patched-tag{font-size:10px;color:#9af2bd;letter-spacing:1.2px}.growth-panel{left:1184px;top:652px;width:672px;height:182px}.growth-panel .panel-head{height:53px}.growth-svg{position:absolute;left:27px;top:67px;width:402px;height:89px}.growth-number{position:absolute;right:27px;top:75px;font-size:33px;letter-spacing:-1px;color:#9af2bd}.growth-number small{display:block;font-size:10px;letter-spacing:.7px;color:#8ba99c;margin-top:8px;text-align:right}.type-panel{left:1184px;top:857px;width:672px;height:149px;padding:23px 26px}.type-title{font-size:12px;letter-spacing:1px;color:#c6d5dd;display:flex;justify-content:space-between}.type-panel p{font-size:15px;line-height:1.9;margin:16px 0 0;color:#a9bec9}.type-panel .tag{font-size:9px;color:#65f5ed;border:1px solid #32565a;padding:4px 7px}.report .footer{bottom:28px}.report .footer .center{color:#738991}
.result{width:1200px;height:630px;background:#060b11}.result:after{position:absolute;inset:16px;content:"";border:1px solid #243c45;pointer-events:none}.result .topbar{top:40px;left:48px;right:48px;height:40px}.result .wordmark{font-size:26px;letter-spacing:2px}.result .brand-icon{width:30px;height:30px}.result .brand-sub{font-size:8px;margin-top:6px}.result .archive-id{text-align:right;font-size:9px;line-height:1.9;letter-spacing:1.4px;color:#728894}.clearance{position:absolute;top:129px;left:52px}.clearance .eyebrow{font-size:10px;letter-spacing:3px;color:#84aaa8}.rank{display:flex;align-items:flex-end;gap:25px;margin-top:4px}.rank .level{font-family:"Avenir Next Condensed",sans-serif;font-size:120px;font-weight:600;line-height:1.07;letter-spacing:-2px;color:#dcfff4}.rank-name{padding-bottom:14px}.rank-name h1{font-family:"Avenir Next Condensed",sans-serif;font-size:42px;line-height:1;font-weight:600;letter-spacing:3px;margin:0}.rank-name .jp{font-size:12px;letter-spacing:2px;color:#829ea7;margin-top:13px}.result-rule{position:absolute;top:292px;left:52px;width:630px;height:1px;background:linear-gradient(90deg,#395963,#213039)}.metrics{position:absolute;left:52px;top:321px;width:619px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:18px}.metric .label{font-size:10px;letter-spacing:1.3px;color:#92aab3}.metric .num{font-family:"Avenir Next Condensed",sans-serif;font-size:48px;font-weight:500;margin-top:11px;line-height:1}.metric .num small{font-family:Menlo,monospace;font-size:12px;color:#9bb1bb;margin-left:3px}.metric .sub{font-size:9px;color:#6a858e;letter-spacing:1px;margin-top:11px}.nearmiss{position:absolute;left:52px;top:447px;width:619px;height:57px;background:#101d25;border-left:2px solid #65f5ed;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font-size:14px;letter-spacing:.5px}.nearmiss b{font-family:Menlo,monospace;font-weight:400;font-size:19px;color:#9af2bd;margin:0 5px}.nearmiss .delta{font-size:10px;letter-spacing:1px;color:#65f5ed}.route-head{position:absolute;left:748px;top:138px}.route-head .eyebrow{color:#8aabb5;font-size:10px;letter-spacing:2px}.route-head .route-sub{font-size:10px;letter-spacing:.8px;color:#617e8c;margin-top:12px}.result-bottom{position:absolute;left:52px;right:52px;bottom:43px;display:flex;align-items:center;justify-content:space-between;font-size:9px;letter-spacing:1px;color:#6c8792}.result-bottom .motto{font-size:13px;letter-spacing:2px;color:#a5bcc6}.result-bottom .run{color:#9af2bd}
'''


def logo():
    return '''<div class="brand"><svg class="brand-icon" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2 36 11v18L20 38 4 29V11Z" fill="none" stroke="#65f5ed" stroke-width="1.5"/><path d="m25 9-13 13h10l-8 10 16-16H19Z" fill="#65f5ed"/></svg><div><div class="wordmark">ICEBREAKER</div><div class="brand-sub">TYPE TO BREACH.</div></div></div>'''


def svg_defs():
    return '''<defs>
      <filter id="bloom" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="softglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="13"/></filter>
      <radialGradient id="aura"><stop stop-color="#0e615e" stop-opacity=".24"/><stop offset=".57" stop-color="#074147" stop-opacity=".08"/><stop offset="1" stop-color="#03070b" stop-opacity="0"/></radialGradient>
      <radialGradient id="pinkAura"><stop stop-color="#881f69" stop-opacity=".27"/><stop offset=".55" stop-color="#40154a" stop-opacity=".10"/><stop offset="1" stop-color="#03070b" stop-opacity="0"/></radialGradient>
      <linearGradient id="iceFill" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0a3440" stop-opacity=".55"/><stop offset=".55" stop-color="#071d28" stop-opacity=".8"/><stop offset="1" stop-color="#482144" stop-opacity=".5"/></linearGradient>
      <linearGradient id="packet" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#65f5ed" stop-opacity="0"/><stop offset="1" stop-color="#aefff7"/></linearGradient>
    </defs>'''


def points(vertices):
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in vertices)


def poly(vertices, stroke=CYAN, opacity=1, width=1, fill='none', more=''):
    return f'<polygon points="{points(vertices)}" stroke="{stroke}" stroke-opacity="{opacity}" stroke-width="{width}" fill="{fill}" {more}/>'


def line(vertices, stroke=CYAN, opacity=1, width=1, more=''):
    return f'<polyline points="{points(vertices)}" fill="none" stroke="{stroke}" stroke-opacity="{opacity}" stroke-width="{width}" {more}/>'


def octagon(cx, cy, r, ratio=.67):
    return [(cx + math.cos(math.pi / 8 + i * math.pi / 4)*r, cy + math.sin(math.pi / 8 + i * math.pi / 4)*r*ratio) for i in range(8)]


def cube(cx, cy, size, color=CYAN, op=.25):
    s = size
    front = [(cx-s,cy-s*.55),(cx+s*.4,cy-s*.9),(cx+s*.4,cy+s*.55),(cx-s,cy+s*.9)]
    back = [(x+s*.68,y-s*.6) for x,y in front]
    items = [poly(front,color,op),poly(back,color,op)]
    items += [line([a,b],color,op) for a,b in zip(front,back)]
    return ''.join(items)


def tunnel(boss=False):
    rng = random.Random(421)
    s = ['<svg class="scene" viewBox="0 0 1920 1080" aria-label="Neon network space">',svg_defs()]
    s += ['<ellipse cx="978" cy="441" rx="620" ry="420" fill="url(#aura)"/>', '<ellipse cx="1130" cy="389" rx="520" ry="360" fill="url(#pinkAura)"/>']
    center=(960,437)
    # Octagonal tunnel frames recede toward one vanishing point.
    for j,r in enumerate([1400,1050,785,575,418,298,209,145,99,69]):
        verts=octagon(*center,r,.75)
        op=.06 + (.14 if j<5 else .04)
        s.append(poly(verts,PINK if j in (2,5) else CYAN,op,1.2))
        if j in (1,3,5):
            s.append(line(verts[1:4],CYAN,.12,2,more='filter="url(#bloom)"'))
    outer=octagon(*center,1700,.75)
    inner=octagon(*center,45,.75)
    for i,(a,b) in enumerate(zip(outer,inner)):
        s.append(line([a,b],PINK if i%3==0 else CYAN,.16,1))
    # Perspective floor with a quiet grid, and diagonal branches to network nodes.
    for x in range(-600,2600,140):
        s.append(line([(960+(x-960)*.06,467),(x,1080)],CYAN,.075))
    for y in [491,515,551,600,673,778,931,1079]:
        s.append(line([(0,y),(1920,y)],CYAN,.055))
    for x,y,sz,col in [(373,304,52,CYAN),(1481,267,76,PINK),(442,578,66,CYAN),(1476,582,41,CYAN),(657,225,23,CYAN),(1278,194,23,PINK),(285,689,28,PINK),(1694,552,37,PINK)]:
        s.append(cube(x,y,sz,col,.28))
        s.append(line([(x,y),(x-28,y+57),(x+12,y+107)],col,.11))
    # Floating points and sparse glitch dashes stay in the game world.
    for _ in range(125):
        x=rng.randrange(30,1890);y=rng.randrange(144,740)
        col=CYAN if rng.random()>.25 else PINK
        s.append(f'<circle cx="{x}" cy="{y}" r="{rng.choice([.7,.8,1,1.5])}" fill="{col}" opacity="{rng.uniform(.12,.4):.2f}"/>')
    for x,y,w,col in [(21,343,45,CYAN),(38,346,13,PINK),(1808,293,68,PINK),(1819,298,22,CYAN),(263,690,27,PINK),(1585,688,39,CYAN),(476,157,20,CYAN),(1374,647,26,PINK)]:
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="2" fill="{col}" opacity=".6"/>')
    # Alignment reticle and telemetry ticks (not another input target).
    for sign in (-1,1):
        x=960+sign*314
        s.append(line([(x-sign*8,434),(x,434),(x,453),(x-sign*8,453)],CYAN,.34))
    if boss:
        s.append(mirror_geometry())
    else:
        s.append(firewall())
    s.append('</svg>')
    return ''.join(s)


def firewall():
    s=[]; cx=976;cy=435
    hexes=[]
    for r in [260,227,205]:
        hexes.append([(cx+math.cos(-math.pi/2+i*math.pi/3)*r,cy+math.sin(-math.pi/2+i*math.pi/3)*r) for i in range(6)])
    # Two offset rear plates make the layer read as depth, not a flat icon.
    for off,op in [(44,.10),(22,.23)]:
        s.append(poly([(x+off,y-off*.28) for x,y in hexes[1]],PINK,op,1))
    s.append(poly(hexes[0],CYAN,.22,1,more='stroke-dasharray="3 9"'))
    s.append(poly(hexes[1],CYAN,.85,1.5,'url(#iceFill)',more='filter="url(#bloom)"'))
    s.append(poly(hexes[2],CYAN,.30,1))
    # Faceted ICE mesh: triangles are structural armor panels.
    inner=[(cx+math.cos(-math.pi/2+i*math.pi/3)*105,cy+math.sin(-math.pi/2+i*math.pi/3)*105) for i in range(6)]
    for i in range(6):
        a=hexes[1][i];b=hexes[1][(i+1)%6];d=inner[i];e=inner[(i+1)%6]
        s.append(poly([a,b,e],CYAN,.37,1,'#11343c20'))
        s.append(poly([a,d,e],CYAN,.27,1,'#0d202933'))
        s.append(line([d,(cx,cy)],CYAN,.23))
    s.append(poly(inner,CYAN,.28,1,'#031016'))
    # The exposed fracture is asymmetric and splits actual armor geometry.
    crack=[(975,208),(985,278),(1016,325),(986,373),(1056,420),(1022,447),(1040,494),(995,556),(1008,637)]
    s.append(line(crack,CYAN,1,2.1,more='filter="url(#bloom)"'))
    for branch in [[(1016,325),(1073,314),(1155,321)],[(1056,420),(1105,395),(1173,414)],[(1022,447),(957,481),(910,475),(861,518)],[(1040,494),(1118,519),(1135,550)]]:
        s.append(line(branch,CYAN,.9,1.3,more='filter="url(#bloom)"'))
    # Missing panel exposes the impact core.
    s.append(poly([(1056,420),(1104,395),(1128,443),(1084,491),(1022,447)],PINK,.7,1.3,'#06121b'))
    rng=random.Random(41)
    for i in range(22):
        angle=rng.uniform(-1.7,1.4);radius=rng.uniform(237,344)
        x=cx+math.cos(angle)*radius;y=cy+math.sin(angle)*radius*.75
        k=rng.uniform(8,23)
        verts=[(x-k,y-k*.5),(x+k*.8,y-k*.9),(x+k*.5,y+k)]
        col=CYAN if i%4 else PINK
        s.append(poly(verts,col,.6,1,'#0b253666',more='filter="url(#bloom)"' if i%5==0 else ''))
        s.append(line([(x-18,y+10),(x-44,y+20)],col,.10))
    # Packets originate immediately above the protected DOM input plate.
    for coords,w,op in [([(824,748),(886,626),(1056,420)],2.5,.85), ([(963,746),(981,617),(1056,420)],2,.8), ([(1101,746),(1115,599),(1056,420)],1.5,.6)]:
        s.append(line(coords,'url(#packet)',op,w,more='filter="url(#bloom)"'))
    for x,y in [(930,573),(990,570),(1093,544)]:
        s.append(poly([(x,y-9),(x+4,y),(x,y+9),(x-4,y)],'#d5fff9',1,1,CYAN,more='filter="url(#bloom)"'))
    s.append('<circle cx="1056" cy="420" r="38" fill="#65f5ed" opacity=".16" filter="url(#softglow)"/><circle cx="1056" cy="420" r="5" fill="#f1fff1" filter="url(#bloom)"/>')
    for i in range(12):
        ang=i*math.pi/6
        s.append(line([(1056+math.cos(ang)*11,420+math.sin(ang)*11),(1056+math.cos(ang)*(39 if i%2 else 58),420+math.sin(ang)*(39 if i%2 else 58))],'#d9ffe4',.8,1,more='filter="url(#bloom)"'))
    return ''.join(s)


def mirror_geometry():
    s=[];cx=960;cy=448
    # A mirrored crystalline defense construct. No organic silhouette or character.
    left=[(960,242),(797,267),(661,392),(686,520),(811,620),(960,655)]
    right=[(1920-x,y) for x,y in left]
    s.append('<ellipse cx="960" cy="447" rx="399" ry="273" fill="url(#pinkAura)"/>')
    for sign,col in [(-1,CYAN),(1,PINK)]:
        def q(v): return [(cx+sign*(cx-x),y) for x,y in v]
        outline=q(left)
        s.append(poly(outline,col,.85,1.5,'#09141f',more='filter="url(#bloom)"'))
        facets=[[(960,242),(797,267),(815,372),(960,343)],[(797,267),(661,392),(740,436),(815,372)],[(661,392),(686,520),(759,494),(740,436)],[(740,436),(759,494),(887,469),(884,408)],[(815,372),(884,408),(960,343)],[(686,520),(811,620),(837,541),(759,494)],[(811,620),(960,655),(960,561),(837,541)],[(837,541),(887,469),(960,505),(960,561)]]
        for i,v in enumerate(facets):
            s.append(poly(q(v),col,.38,1,'#14313d33' if sign==-1 else '#4a1d4033'))
            if i in (0,2,5):
                # Parallel ruled reflections on mirror facets.
                a,b,c=v[0],v[1],v[-1]
                for t in [.2,.4,.6,.8]:
                    p=(a[0]+(c[0]-a[0])*t,a[1]+(c[1]-a[1])*t)
                    p2=(b[0]+(c[0]-b[0])*t,b[1]+(c[1]-b[1])*t)
                    s.append(line(q([p,p2]),col,.14))
        eye=q([(742,411),(878,394),(887,442),(790,460)])
        s.append(poly(eye,col,.8,1,'#041018'))
        s.append(line(q([(753,418),(876,407),(830,438),(779,444)]),col,.9,2.8,more='filter="url(#bloom)"'))
        s.append(line(q([(703,506),(747,552),(815,586)]),col,.7,1.4,more='filter="url(#bloom)"'))
    s.append(poly([(960,351),(1027,452),(960,538),(893,452)],'#ddd2f6',.7,1.2,'#221d34'))
    s.append(poly([(960,380),(1005,451),(960,507),(915,451)],PINK,.9,1.2,'#661d5b22',more='filter="url(#bloom)"'))
    s.append(poly([(960,414),(982,452),(960,476),(938,452)],'#ffd5ed',1,1,'#ffa2db',more='filter="url(#bloom)"'))
    s.append(line([(960,249),(960,342)],'#b4a9d8',.4))
    s.append(line([(960,542),(960,645)],'#b4a9d8',.4))
    # The counter attack leaves the core and bends toward the player.
    for sign in [-1,1]:
        s.append(line([(960+sign*322,490),(960+sign*396,573),(960+sign*430,704)],RED,.38,1.5,more='filter="url(#bloom)"'))
        s.append(poly([(960+sign*425,686),(960+sign*439,710),(960+sign*417,707)],RED,.8,1,'#641d2c'))
    # Minimal circular orbital instrumentation reinforces AI symmetry.
    s.append('<path d="M567 425a399 233 0 0 1 786 0M567 460a399 233 0 0 0 786 0" stroke="#746994" stroke-opacity=".3" fill="none" stroke-dasharray="2 11"/>')
    s.append('<circle cx="960" cy="452" r="175" fill="none" stroke="#f877be" stroke-opacity=".08"/>')
    return ''.join(s)


def trace(percent,boss=False):
    chunks=''.join(f'<i class="{"on" if i<round(percent/5) else ""}"></i>' for i in range(20))
    return f'<div class="trace"><div class="trace-label"><span>[ TRACE ]</span><b>{percent}<small style="font-size:12px">%</small></b></div><div class="trace-track">{chunks}</div><div class="trace-note">{"COUNTER WINDOW OPEN" if boss else "SIGNAL EXPOSURE / STABLE"}</div></div>'


def input_panel(boss=False):
    label='COUNTER ▶ 次の語' if boss else 'INPUT // 026'
    nxt='<span class="next">NEXT <span class="jp">回復</span> kaifuku</span>' if boss else '<span class="next">NEXT <span class="jp">接続</span> setsuzoku</span>'
    if boss:
        word='<div class="word jp">きょうりょく</div><div class="romaji"><span class="typed">kyo</span><span class="cursor"></span><span>uryoku</span></div>'
    else:
        word='<div class="word jp">脆弱性</div><div class="reading jp">ぜいじゃくせい</div><div class="romaji"><span class="typed">zeija</span><span class="cursor"></span><span>kusei</span></div>'
    status='INTERCEPT // 03 / 09' if boss else 'DECRYPTING // 05 / 10'
    return f'''<section class="input-panel" aria-label="Fixed typing input"><div class="input-head"><span class="input-label">{label}</span>{nxt}</div><div class="input-body">{word}</div><div class="input-meta"><span>JP / ROMAJI <span style="color:#344b58">&nbsp;│&nbsp;</span> IME OFF</span><span class="progress">{status}<span class="microtrack"><i style="width:{33 if boss else 50}%"></i></span></span></div></section>'''


def gameplay(boss=False):
    number=128 if boss else 87
    st='<i class="active"></i><i class="active"></i><i class="last"></i>' if boss else '<i class="active"></i><i class="active"></i><i></i>'
    banner='<div class="telegraph"><span class="warn">⌁</span><span class="message jp"><strong>MIRROR:</strong> 解析完了 ─ 標的: <span class="mono">k→y</span> 遷移 / 促音処理</span></div>' if boss else '<div class="critical">✦ CRITICAL<small>SELF-BASELINE −42ms</small></div>'
    enemy='''<div class="enemy-info"><div class="id">[ COUNTER-AI // 001 ]</div><h2>MIRROR</h2><div class="kind jp">適応型防衛コア</div><div class="integrity"><span>CORE INTEGRITY</span><span class="pink">62%</span></div><div class="integrity-line"><i style="width:62%"></i></div><div class="enemy-log">&gt; PATTERN ANALYZED<br><span class="active">&gt; k→y / TARGET LOCK</span><br>&gt; COUNTER QUEUED<br><span style="color:#b68aaf">&gt; RECOVERY NEXT</span></div></div><div class="counter-timer">INTERCEPT WINDOW<b>02.48<span style="font-size:13px"> s</span></b><div class="timebar"><i></i></div></div>''' if boss else '''<div class="enemy-info"><div class="id">[ ICE // FW-026 ]</div><h2>FIREWALL</h2><div class="kind jp">標準防壁 / 第 02 層</div><div class="integrity"><span>LAYER INTEGRITY</span><span class="pink">38%</span></div><div class="integrity-line"><i></i></div><div class="enemy-log">&gt; PACKET ACCEPTED<br><span class="active">&gt; FRACTURE DETECTED</span><br>&gt; ROUTE REBUILDING<br>&gt; AWAITING BREACH_</div></div>'''
    return f'''<main class="screen {'boss' if boss else 'dive'}">{tunnel(boss)}<div class="topbar">{logo()}<div class="top-center"><div class="sector">SECTOR <em>{3 if boss else 2}</em> / 3</div><div class="sector-sub">{'AI INTERIOR / FINAL DEFENSE' if boss else 'CORPORATE MESH / INNER RING'}</div></div>{trace(68 if boss else 34,boss)}</div><div class="topline"></div>{banner}<aside class="chain"><div class="label">[ CHAIN ]</div><div class="number">{number}</div><div class="caption">CONTINUOUS SIGNAL</div><div class="overclock"><div class="eyebrow">OVERCLOCK</div><div class="stages">{st}</div><div class="eyebrow" style="font-size:9px;color:#65f5ed">{'III / FULL SPECTRUM' if boss else 'II / RESONANCE'}</div></div></aside><aside class="depth"><div class="ruler"></div><div><div class="eyebrow">DIVE DEPTH</div><div class="depth-value">{9840 if boss else '6,420'}<small> m</small></div><div class="depth-tiny">▾ {'AI CORE' if boss else 'INNER NETWORK'}</div></div></aside>{enemy}<div class="ice-index"><span>◈ {'ADAPTIVE CORE' if boss else 'LAYER 02 / 05'}</span><span class="pill">{'MIRROR ONLINE' if boss else 'BREACH IN PROGRESS'}</span></div>{input_panel(boss)}<footer class="footer"><span><kbd>ESC</kbd> PAUSE <span style="margin-left:24px">[ 音声 ON ]</span></span><span class="center">RUN 0{'3:12' if boss else '1:47'} <span style="color:#28404a">&nbsp; / &nbsp;</span> CONNECTION 92%</span><span class="signal">● LOCAL LINK / 12ms</span></footer></main>'''


def keyboard():
    rows=[
        [('ESC','',1),('1','ぬ',1),('2','ふ',1),('3','あ',1),('4','う',1),('5','え',1),('6','お',1),('7','や',1),('8','ゆ',1),('9','よ',1),('0','わ',1),('-','ほ',1),('^','へ',1),('¥','ー',1),('⌫','',1.6)],
        [('TAB','',1.4),('Q','た',1),('W','て',1),('E','い',1),('R','す',1),('T','か',1),('Y','ん',1),('U','な',1),('I','に',1),('O','ら',1),('P','せ',1),('@','゛',1),('[','゜',1),('ENTER','',2.2)],
        [('CTRL','',1.6),('A','ち',1),('S','と',1),('D','し',1),('F','は',1),('G','き',1),('H','く',1),('J','ま',1),('K','の',1),('L','り',1),(';','れ',1),(':','け',1),(']','む',1),('↵','',2)],
        [('SHIFT','',2.1),('Z','つ',1),('X','さ',1),('C','そ',1),('V','ひ',1),('B','こ',1),('N','み',1),('M','も',1),(',','ね',1),('.','る',1),('/','め',1),('_','ろ',1),('SHIFT','',2.5)],
        [('FN','',1),('CTRL','',1),('OPT','',1),('CMD','',1.3),('英数','',1.25),('SPACE','',4.65),('かな','',1.25),('CMD','',1.3),('OPT','',1),('←','',1),('↑↓','',1),('→','',1)]
    ]
    # Normalize each JIS row into the same bounding width.
    parts=[]
    for row in rows:
        unit=(1044-6*(len(row)-1))/sum(k[2] for k in row)
        keys=[]
        for main,sub,size in row:
            kind=' critical-key' if main in ('K','Y') else ' hot' if main in ('W','S') else ' warm' if main in ('X','E','R','N','J') else ''
            home='<i class="homeline"></i>' if main in ('F','J') else ''
            keys.append(f'<div class="key{kind}" style="width:{unit*size:.2f}px"><span class="mainkey">{main}</span><span class="subkey jp">{sub}</span>{home}</div>')
        parts.append('<div class="keyrow">'+''.join(keys)+'</div>')
    return '<div class="keyboard">'+''.join(parts)+'</div>'


def matrix():
    labels=['a','s','d','f','g','h','j','k','l','y','n','t']; rng=random.Random(72)
    out=['<svg class="matrix-svg" viewBox="0 0 337 248" aria-label="Bigram delay heatmap">']
    colors=['#152c36','#1d4149','#255c60','#6d5d3c','#975553','#e86b8e']
    for i,key in enumerate(labels):
        color='#ff94ae' if key in ['k','y'] else '#6d8792'
        out.append(f'<text x="{36+i*17}" y="13" text-anchor="middle" fill="{color}" font-size="10" font-family="Menlo">{key}</text>')
        out.append(f'<text x="15" y="{34+i*17}" text-anchor="middle" fill="{color}" font-size="10" font-family="Menlo">{key}</text>')
        for j in range(12):
            v=rng.choices([0,1,2,3,4],[.32,.32,.20,.12,.04])[0]
            if i==7 and j==9:v=5
            out.append(f'<rect x="{29+j*17}" y="{22+i*17}" width="14" height="14" rx="1" fill="{colors[v]}"/>')
    out.append('<rect x="180" y="139" width="18" height="18" fill="none" stroke="#ffd8e7" stroke-width="1.2"/>')
    out.append('<path d="M200 148h42l24-22h40" stroke="#ff94ae" stroke-opacity=".7" fill="none"/>')
    out.append('<text x="242" y="119" fill="#ff94ae" font-size="9" font-family="Menlo">k → y</text>')
    out.append('<text x="28" y="243" fill="#637e8b" font-size="8" font-family="Menlo">PREV ↓ / NEXT →</text></svg>')
    return ''.join(out)


def growth():
    return '''<svg class="growth-svg" viewBox="0 0 402 89" aria-label="Growth trend"><defs><linearGradient id="growth" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#65f5ed" stop-opacity=".2"/><stop offset="1" stop-color="#65f5ed" stop-opacity="0"/></linearGradient></defs><path d="M0 13H395M0 36H395M0 59H395" stroke="#243743" stroke-width="1" stroke-dasharray="2 5"/><path d="M1 56 38 50 75 54 112 37 149 41 186 29 223 35 260 18 297 23 334 13 375 7V67H1Z" fill="url(#growth)"/><path d="M1 56 38 50 75 54 112 37 149 41 186 29 223 35 260 18 297 23 334 13 375 7" fill="none" stroke="#65f5ed" stroke-width="2"/><circle cx="375" cy="7" r="3" fill="#d3fff3"/><text x="0" y="86" fill="#718a95" font-size="9" font-family="Menlo">09.02</text><text x="164" y="86" fill="#718a95" font-size="9" font-family="Menlo">09.16</text><text x="352" y="86" fill="#718a95" font-size="9" font-family="Menlo">10.01</text></svg>'''


def report():
    legend=''.join(f'<i style="background:{c}"></i>' for c in ['#1d4149','#255c60','#6d5d3c','#975553','#e86b8e'])
    rows=[
        ('0042','<strong>k→y</strong> 遷移遅延','HIGH','high','38',True,False),
        ('0017','<strong>っ</strong>（促音）ミス率','MED','med','21',False,False),
        ('0031','左薬指 段越え','MED','med','17',False,False),
        ('0008','<strong>n→n</strong> 遷移遅延','PATCHED','','0',False,True)
    ]
    trs=[]
    for id,desc,sev,klass,impact,primary,patched in rows:
        button='<span class="patched-tag">✓ PATCH VERIFIED</span>' if patched else f'<button class="patch {"primary" if primary else ""}">[ パッチ開始 ]</button>'
        trs.append(f'<div class="vuln-row {"patched-row" if patched else ""}"><span class="identifier">VULN-{id}</span><span class="description jp">{desc}</span><span class="severity {klass}">{sev}</span><span class="impact">+{impact}<small>ms / 1000打</small></span><span>{button}</span></div>')
    return f'''<main class="screen report"><div class="topbar">{logo()}<nav class="nav"><span>DIVE</span><span class="selected">VULNERABILITY</span><span>ARCHIVE</span></nav><div class="session">[ LOCAL ANALYSIS ] &nbsp; 2026.10.01</div></div><div class="topline"></div><div class="report-heading"><div class="eyebrow">SYSTEM DIAGNOSTICS / PERSONAL PATCHES</div><h1 class="jp">脆弱性レポート <span class="heading-inline mono">// BUILD A BETTER YOU.</span></h1></div><div class="report-summary"><div><div class="eyebrow">ACTIVE</div><div class="value pink">03</div></div><div><div class="eyebrow">PATCHED</div><div class="value green">08</div></div><div><div class="eyebrow">SAMPLE</div><div class="value">24,816 <small>打鍵</small></div></div></div><section class="panel keyboard-panel"><div class="panel-head"><span class="heading"><span class="index">01</span><span class="jp">キーボードヒートマップ</span> <span style="color:#557584;font-size:10px;margin-left:10px">[ JIS ]</span></span><div class="toggle"><span class="on jp">遅さ</span><span class="jp">ミス率</span></div></div>{keyboard()}<div class="heatmap-caption"><span class="jp">標準運指 · 同条件の遷移で比較</span><span class="legend"><span>FAST</span><span class="legend-strip">{legend}</span><span>SLOW</span><span style="color:#ff94ae;margin-left:15px">k / y &nbsp; +42ms</span></span></div></section><section class="panel matrix-panel"><div class="panel-head"><span class="heading"><span class="index">02</span><span class="jp">遷移マトリクス</span></span><span style="color:#60808e;font-size:10px">BIGRAM / 12 × 12</span></div>{matrix()}<div class="matrix-callout"><div class="eyebrow">TOP VULNERABILITY</div><h2>k → y</h2><div class="matrix-stat">+38ms / 1000打<br><span class="pink">HIGH IMPACT</span></div><div class="matrix-note jp">右手から左手への遷移。<br>拗音でリズムが途切れる。</div></div><div class="matrix-foot jp">縦: 直前キー / 横: 次キー &nbsp; · &nbsp; 100回以上の遷移を表示</div></section><section class="panel vulns-panel"><div class="panel-head"><span class="heading"><span class="index">03</span><span class="jp">改善インパクト順</span></span><span class="eyebrow" style="font-size:9px">3 ACTIVE / 1 RECENTLY PATCHED</span></div><div class="table"><div class="table-head"><span>VULNERABILITY ID</span><span class="jp">検出された課題</span><span class="jp">深刻度</span><span class="jp">改善インパクト</span><span>ACTION</span></div>{''.join(trs)}</div></section><section class="panel growth-panel"><div class="panel-head"><span class="heading"><span class="index">04</span><span class="jp">成長ログ</span></span><span class="eyebrow" style="font-size:9px">BENCHMARK / 30 DAYS</span></div>{growth()}<div class="growth-number">+0.6<small class="jp">字/秒 · 自己基準</small></div></section><section class="panel type-panel"><div class="type-title"><span class="jp">あなたの打鍵タイプ</span><span class="tag">ALTERNATING / 安定型</span></div><p class="jp">交互打鍵は安定。<span style="color:#e8c895">k→y</span> と左薬指の段越えに遅延。<br><span style="color:#8197a4;font-size:12px">まずは拗音のパッチから。克服は初見の確認問題で判定。</span></p></section><footer class="footer"><span><kbd>ESC</kbd> BACK TO DIVE</span><span class="center jp">ログはあなたの端末だけに保存されます。</span><span class="signal">● ANALYSIS COMPLETE</span></footer></main>'''


def route():
    out=['<svg class="scene" viewBox="0 0 1200 630" aria-label="Intrusion circuit path">',svg_defs(),'<ellipse cx="956" cy="342" rx="296" ry="254" fill="url(#aura)"/>']
    # Fine circuit substrate; a single lit route records the player's run.
    for x in range(716,1170,30):
        for y in range(200,530,30):
            out.append(f'<circle cx="{x}" cy="{y}" r=".65" fill="#284652"/>')
    branches=[[(727,283),(777,283),(807,253),(861,253),(884,230),(1027,230)],[(748,458),(797,458),(845,410),(929,410),(960,441),(1106,441)],[(772,354),(802,324),(922,324),(952,294),(1113,294)],[(850,218),(850,275),(899,324)],[(1054,225),(1054,267),(1080,293),(1080,495)],[(988,514),(988,451),(1024,415),(1126,415)],[(910,257),(910,212),(990,212)],[(797,458),(797,488),(857,488)]]
    for b in branches:out.append(line(b,CYAN,.16,1))
    path=[(749,482),(786,482),(831,437),(831,388),(884,335),(932,335),(976,291),(1017,291),(1055,329),(1091,329),(1122,298),(1122,233)]
    out.append(line(path,CYAN,.28,8,more='filter="url(#softglow)"'))
    out.append(line(path,CYAN,.9,2.5,more='filter="url(#bloom)"'))
    out.append(line([(932,335),(976,291),(1017,291),(1055,329),(1091,329)],PINK,1,2.5,more='filter="url(#bloom)"'))
    nodes=[(749,482,'ENTRY',-3,27,CYAN),(831,388,'SECTOR 01',-70,-20,CYAN),(976,291,'SECTOR 02',-47,-24,PINK),(1122,233,'MIRROR',-64,-22,CYAN)]
    for x,y,label,dx,dy,col in nodes:
        out.append(poly([(x,y-8),(x+7,y-4),(x+7,y+4),(x,y+8),(x-7,y+4),(x-7,y-4)],col,1,1.2,'#08171e'))
        out.append(f'<circle cx="{x}" cy="{y}" r="2.5" fill="{col}" filter="url(#bloom)"/><text x="{x+dx}" y="{y+dy}" fill="#8aabb7" font-size="8" letter-spacing="1.2" font-family="Menlo">{label}</text>')
    for x,y in [(850,369),(955,312),(1071,329)]:
        out.append(f'<circle cx="{x}" cy="{y}" r="12" fill="#09241e" stroke="#9af2bd" stroke-opacity=".7"/>')
        out.append(line([(x-4,y),(x-1,y+3),(x+5,y-4)],GREEN,1,1.5))
    out.append('<text x="749" y="552" fill="#526f7d" font-size="8" font-family="Menlo" letter-spacing="1.5">03 SECTORS / 17 LAYERS / 03 PATCHES</text></svg>')
    return ''.join(out)


def result():
    return f'''<main class="screen result">{route()}<div class="topbar">{logo()}<div class="archive-id">INTRUSION ARCHIVE / 0048<br><span style="color:#9af2bd">[ RUN COMPLETE ]</span> &nbsp; 2026.10.01</div></div><section class="clearance"><div class="eyebrow">CLEARANCE VERIFIED</div><div class="rank"><div class="level">L4</div><div class="rank-name"><h1>INTRUDER</h1><div class="jp">侵入者 / 自分の限界を突破する。</div></div></div></section><div class="result-rule"></div><section class="metrics"><div class="metric"><div class="label jp">速度</div><div class="num">7.8<small>字/秒</small></div><div class="sub">468 KANA / MIN</div></div><div class="metric"><div class="label jp">正確率</div><div class="num">97.4<small>%</small></div><div class="sub">PRECISION</div></div><div class="metric"><div class="label">MAX CHAIN</div><div class="num">214</div><div class="sub">UNBROKEN SIGNAL</div></div><div class="metric"><div class="label green">PATCHED</div><div class="num green">3</div><div class="sub">VERIFIED PATCHES</div></div></section><div class="nearmiss"><span class="jp">自己ベストまで あと <b>0.3</b> 字/秒</span><span class="delta">PB 8.1</span></div><div class="route-head"><div class="eyebrow">YOUR INTRUSION ROUTE</div><div class="route-sub jp">打鍵で開いた、あなただけの経路。</div></div><div class="result-bottom"><span class="motto jp">打鍵で、電脳を割れ。</span><span class="run">RUN 03:48 &nbsp; / &nbsp; MIRROR BREACHED</span></div></main>'''


def document(content,title,width=1920,height=1080):
    return f'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width={width}, initial-scale=1"><title>{title} — ICEBREAKER</title><style>{CSS}</style></head><body>{content}</body></html>'''


if __name__=='__main__':
    for name,title,content,w,h in [
        ('01_dive','DIVE / 主画面',gameplay(),1920,1080),
        ('02_mirror','MIRROR / 対抗AI',gameplay(True),1920,1080),
        ('03_vuln_report','脆弱性レポート',report(),1920,1080),
        ('04_result_card','侵入記録 / L4 INTRUDER',result(),1200,630)
    ]:
        target=OUT/(name+'.html')
        target.write_text(document(content,title,w,h),encoding='utf-8')
        print(f'{target.name}: {w} × {h}')
