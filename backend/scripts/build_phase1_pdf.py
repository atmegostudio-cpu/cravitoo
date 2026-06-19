"""Convert /app/PHASE1_REPORT.md into a polished PDF for sharing."""
from pathlib import Path
from markdown_pdf import MarkdownPdf, Section

SRC = Path("/app/PHASE1_REPORT.md")
DEST = Path("/app/frontend/public/cravitoo-phase1-report.pdf")

CSS = """
body { font-family: 'Helvetica', 'Arial', sans-serif; color: #1f2937; line-height: 1.55; }
h1 { color: #0f172a; border-bottom: 3px solid #f97316; padding-bottom: 8px; margin-top: 28px; font-size: 26px; }
h2 { color: #0f172a; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-top: 22px; font-size: 19px; }
h3 { color: #1f2937; margin-top: 16px; font-size: 15px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 11px; }
th { background: #f97316; color: white; text-align: left; padding: 6px 8px; }
td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; vertical-align: top; }
tr:nth-child(even) td { background: #fafafa; }
code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 11px; color: #be123c; }
pre { background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; font-size: 10px; overflow-x: auto; }
pre code { background: transparent; color: inherit; padding: 0; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
ul, ol { padding-left: 22px; }
li { margin: 3px 0; font-size: 12px; }
p { font-size: 12px; }
blockquote { border-left: 4px solid #f97316; padding-left: 12px; color: #475569; font-style: italic; }
"""


def main() -> None:
    md_text = SRC.read_text(encoding="utf-8")
    pdf = MarkdownPdf(toc_level=2, optimize=True)
    pdf.meta["title"] = "Cravitoo — Phase 1 Critical Fix Report"
    pdf.meta["author"] = "Cravitoo Engineering"
    pdf.meta["subject"] = "Phase 1 security & lifecycle fixes"
    pdf.add_section(Section(md_text, toc=True), user_css=CSS)
    DEST.parent.mkdir(parents=True, exist_ok=True)
    pdf.save(str(DEST))
    print(f"Wrote {DEST} ({DEST.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
