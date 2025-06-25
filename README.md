# MarkPDF

A simple tool to watch Markdown files and automatically generate PDFs using markserv and puppeteer.

## Features

- 📝 Watches Markdown files for changes
- 🔄 Automatically regenerates PDF when file changes
- 🎨 Uses GitHub-style markdown rendering via markserv
- 📄 High-quality PDF generation via puppeteer
- 🚀 Live development workflow

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Make sure you have Chromium installed (for puppeteer)

## Usage

```bash
./markpdf <markdown-file>
```

Examples:
```bash
./markpdf resume.md
./markpdf /path/to/document.md
```

The tool will:
1. Start a local markserv server to render the markdown as HTML
2. Generate an initial PDF
3. Watch the markdown file for changes
4. Automatically regenerate the PDF when changes are detected

Press `Ctrl+C` to stop watching and clean up.

## Output

The PDF will be saved in the same directory as the input markdown file with the same name but `.pdf` extension.

## Dependencies

- **chokidar**: File watching
- **markserv**: Markdown to HTML rendering with GitHub styling
- **puppeteer**: HTML to PDF conversion

## Styling

The tool uses custom CSS (`styles.css`) optimized for PDF output with:
- Letter-size pages
- 0.5 inch margins
- Inter font family
- Proper print styling

You can modify `styles.css` to customize the PDF appearance.
