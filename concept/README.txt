ICEBREAKER — CONCEPT SCREENS

Based on DESIGN.md v0.4, particularly sections 0, 1, 2.1, 4.4 and 7.
DESIGN.md was not modified. All deliverables and supporting files are here.

DELIVERABLES
01_dive.png         1920 × 1080   Main gameplay / cracking firewall
01_dive.html        Inline HTML, CSS and SVG source
02_mirror.png       1920 × 1080   Geometric MIRROR boss / counter word
02_mirror.html      Inline HTML, CSS and SVG source
03_vuln_report.png  1920 × 1080   Keyboard and bigram heatmaps / patch list
03_vuln_report.html Inline HTML, CSS and SVG source
04_result_card.png  1200 × 630    L4 INTRUDER / recorded circuit route
04_result_card.html Inline HTML, CSS and SVG source

PRODUCTION
All four screens use custom HTML/CSS and inline SVG geometry; no generated
raster images, stock assets, external image links, scripts or font downloads.
The wireframe worlds, fracture mesh, mirrored AI facets, heatmaps, growth
chart and circuit route are drawn in SVG/CSS. Input text is real DOM text on
an opaque plate. The two gameplay input plates share x=480, y=754 and
960 × 252 dimensions. Bloom filters affect only the world illustration;
the boss plate's red glow is a CSS border/box shadow, separate from its text.

Google Chrome 154 is installed, but its headless process did not start in
this managed shell. Browser automation also refused local file:// URLs.
No alternate URL or file-navigation workaround was used. Final PNGs were
rendered from HTML strings in memory with macOS's in-process compatibility
WebKit engine, using the installed Swift compiler and system frameworks.
This renderer performs no network navigation and needs no added packages.

RECREATE ON THIS MAC
From /Users/oshida/dev/game_typing:

  python3 concept/build_mockups.py
  mkdir -p concept/.swift-cache concept/.tmp
  TMPDIR=/Users/oshida/dev/game_typing/concept/.tmp swift \
    -suppress-warnings \
    -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk \
    -module-cache-path concept/.swift-cache \
    concept/render_inprocess.swift \
    /Users/oshida/dev/game_typing/concept

The explicit SDK is needed because this Mac's default 27.0 SDK is newer
than its installed Swift compiler. Compiler cache and temporary directories
are kept inside concept/ and can be removed after rendering.

VERIFICATION
verification.json records the DOM dimensions, opaque input backgrounds,
one input panel per gameplay screen, absence of text effects including
ancestor filters, absence of external assets and layout overflow, and
CoreText Japanese glyph coverage with HiraginoSans-W3. PNG header dimensions
were checked separately. Each final PNG was visually inspected for Japanese
glyphs, crisp input text, hierarchy, bloom placement and clipping.

LIMITATIONS
These are static fixed-size visual concepts; buttons and typing are not
interactive. Statistics, vulnerability ranks and routes are sample data.
JIS keyboard geometry is approximate. Fonts use installed Menlo, Hiragino
and Avenir Next Condensed; HTML may have different font metrics on another
OS. PNG appearance is fixed. The rendering helper uses deprecated WebView
only as an offline export tool; it is not a proposed game-runtime API.
