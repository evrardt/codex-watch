"""Generate the offline HTML guide from README.md. Requires markdown-it-py."""
from pathlib import Path
import argparse
import re

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent.parent
markdown = MarkdownIt("commonmark", {"html": True}).enable("table")
def render_with_anchors(source):
    tokens = markdown.parse(source)
    seen = {}
    for index, token in enumerate(tokens):
        if token.type != 'heading_open':
            continue
        title = tokens[index + 1].content.lower()
        slug = re.sub(r'[^\w\- ]', '', title, flags=re.UNICODE).replace(' ', '-')
        count = seen.get(slug, 0)
        seen[slug] = count + 1
        token.attrSet('id', slug if count == 0 else f'{slug}-{count}')
    return markdown.renderer.render(tokens, markdown.options, {})

body = render_with_anchors((ROOT / "README.md").read_text(encoding="utf-8")).replace('href="docs/INSTALLER-VPS.md"', 'href="docs/INSTALLER-VPS.html"')
vps_body = render_with_anchors((ROOT / "docs" / "INSTALLER-VPS.md").read_text(encoding="utf-8")).replace('href="../README.md#', 'href="../GUIDE-INSTALLATION.html#')
styles = """
:root { color-scheme: light; font-family: 'Segoe UI', system-ui, sans-serif; color: #182820; background: #f3f8f5; }
* { box-sizing: border-box; }
body { margin: 0; padding: 36px 20px; }
main { max-width: 940px; margin: auto; padding: clamp(24px, 5vw, 56px); background: white; border: 1px solid #dfebe3; border-radius: 24px; box-shadow: 0 12px 40px #1434220d; line-height: 1.65; }
h1 { font-size: clamp(2rem, 5vw, 2.8rem); color: #113d29; margin-top: 0; }
h2 { margin-top: 2.2em; padding-bottom: .3em; border-bottom: 1px solid #d7e8dc; }
h3 { margin-top: 2em; color: #1d5338; }
a { color: #176b49; }
img { max-width: 100%; height: auto; border-radius: 10px; }
img[src*='montre-'] { width: 230px; max-width: 100%; background: #000; }
img[src*='pc-'] { width: 760px; border: 1px solid #d3e1d7; }
pre { overflow: auto; padding: 16px; background: #13241b; color: #eef8f1; border-radius: 12px; }
code { font-family: Consolas, monospace; overflow-wrap: anywhere; }
pre code { overflow-wrap: normal; }
blockquote { margin: 1.3em 0; padding: 4px 18px; border-left: 4px solid #86c5a2; background: #eff8f2; }
table { display: block; overflow-x: auto; border-collapse: collapse; }
th, td { border: 1px solid #d6e5da; padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: #f0f8f2; }
@media (max-width: 600px) { body { padding: 0; } main { padding: 24px 18px; border: 0; border-radius: 0; } }
"""
html = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Watch — guide d’installation</title><style>{styles}</style></head><body><main>
{body}
</main></body></html>
"""
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="Fail if the committed HTML is stale")
args = parser.parse_args()
guide = ROOT / "GUIDE-INSTALLATION.html"
vps_guide = ROOT / "docs" / "INSTALLER-VPS.html"
vps_html = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Watch — installer le VPS</title><style>{styles}</style></head><body><main>
{vps_body}
</main></body></html>
"""
if args.check:
    if not guide.exists() or guide.read_text(encoding="utf-8") != html:
        raise SystemExit("GUIDE-INSTALLATION.html is out of date; run python scripts/render-guide-html.py")
    if not vps_guide.exists() or vps_guide.read_text(encoding="utf-8") != vps_html:
        raise SystemExit("docs/INSTALLER-VPS.html is out of date; run python scripts/render-guide-html.py")
    print("Offline guide matches README.md")
else:
    guide.write_text(html, encoding="utf-8")
    vps_guide.write_text(vps_html, encoding="utf-8")
