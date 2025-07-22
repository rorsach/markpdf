# MarkPDF

A simple tool to watch Markdown files and automatically generate PDFs. This tool offers two methods for PDF generation:

1.  `markpdf.js`: Uses `puppeteer`.
2.  `markpdf-chromium.js`: Uses a direct Chromium CLI command.

The `markpdf-chromium.js` script was created to address stability issues with `puppeteer`, particularly the lack of official ARM64 Chromium builds and compatibility problems with Firefox.

## Features

- 📝 Watches Markdown files for changes
- 🔄 Automatically regenerates PDF when file changes
- 🎨 Uses GitHub-style markdown rendering via markserv
- 📄 High-quality PDF generation
- 🚀 Live development workflow

## Installation

1.  Clone or download this repository
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Make sure you have Chromium installed.

## Usage

The primary script is now `markpdf-chromium.js` for better stability.

```bash
./markpdf <markdown-file>
```

This will use the `markpdf-chromium.js` script by default.

Examples:
```bash
./markpdf resume.md
./markpdf /path/to/document.md
```

The tool will:
1.  Start a local markserv server to render the markdown as HTML
2.  Generate an initial PDF
3.  Watch the markdown file for changes
4.  Automatically regenerate the PDF when changes are detected

Press `Ctrl+C` to stop watching and clean up.

### Legacy Puppeteer Usage

If you need to use the original `puppeteer`-based script, you can run it directly:
```bash
node markpdf.js <markdown-file>
```

## Output

The PDF will be saved in the same directory as the input markdown file with the same name but `.pdf` extension.

## Dependencies

- **chokidar**: File watching
- **markserv**: Markdown to HTML rendering with GitHub styling
- **puppeteer**: HTML to PDF conversion (used in `markpdf.js`)

## Styling

The tool uses custom CSS (`styles.css`) optimized for PDF output with:
- Letter-size pages
- 0.5 inch margins
- Noto font family
- Proper print styling

You can modify `styles.css` to customize the PDF appearance.

## PDF Metadata

The script can automatically embed metadata into the generated PDF. To use this feature, create a file named `<your-document-name>-metadata.md` in the same directory as your source markdown file.

For example, if you are converting `resume.md`, you should create a `resume-metadata.md` file.

### Metadata Format

The metadata file should contain key-value pairs, with each entry on a new line, separated by a colon (`:`).

Example `resume-metadata.md`:
```
Title: My Resume
Author: John Doe
Subject: Professional Experience
Keywords: Software Engineer, Web Developer, Resume
Creator: MarkPDF
```

### Supported Metadata Fields

The script uses `exiftool` to embed metadata. Here are some common metadata fields you can use:

- `Title`
- `Author`
- `Subject`
- `Keywords`
- `Creator`
- `Producer`
- `CreationDate` (e.g., `2023:10:27 10:00:00`)
- `ModDate` (e.g., `2023:10:27 10:00:00`)
- `Copyright`

**Note:** This feature requires `exiftool` to be installed on your system. If `exiftool` is not found, the script will print a warning and skip the metadata injection step.
