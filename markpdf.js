const chokidar = require('chokidar');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

class MarkPDF {
  constructor(inputFile) {
    this.inputFile = path.resolve(inputFile);
    this.inputDir = path.dirname(this.inputFile);
    this.inputBasename = path.basename(this.inputFile, '.md');
    this.outputFile = path.join(this.inputDir, `${this.inputBasename}.pdf`);
    this.htmlFile = `${this.inputBasename}.html`;
    this.port = 8000;
    this.markservUrl = `http://localhost:${this.port}/${this.htmlFile}`;
    this.markservProcess = null;
    this.toolDir = __dirname;
  }

  async findAvailablePort(startPort = 8000) {
    const net = require('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(startPort, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', () => {
        resolve(this.findAvailablePort(startPort + 1));
      });
    });
  }

  async setupWorkingDirectory() {
    // Copy template files to working directory
    const indexTemplate = path.join(this.toolDir, 'index.html');
    const stylesTemplate = path.join(this.toolDir, 'styles.css');
    const workingIndex = path.join(this.inputDir, this.htmlFile);
    const workingStyles = path.join(this.inputDir, 'styles.css');

    // Check if template files exist
    if (!fs.existsSync(indexTemplate)) {
      throw new Error(`Template file not found: ${indexTemplate}`);
    }
    if (!fs.existsSync(stylesTemplate)) {
      throw new Error(`Template file not found: ${stylesTemplate}`);
    }

    // Read template and replace placeholder
    let indexContent = fs.readFileSync(indexTemplate, 'utf8');
    indexContent = indexContent.replace('MARKDOWN_FILE', path.basename(this.inputFile));
    
    // Write files to working directory
    fs.writeFileSync(workingIndex, indexContent);
    fs.copyFileSync(stylesTemplate, workingStyles);

    console.log(`📁 Created temporary files in ${this.inputDir}`);
    console.log(`   📄 ${this.htmlFile} (HTML wrapper)`);
    console.log(`   🎨 styles.css (PDF styles)`);
  }

  async startMarkserv() {
    this.port = await this.findAvailablePort();
    this.livereloadPort = await this.findAvailablePort(35729);
    this.markservUrl = `http://localhost:${this.port}/${this.htmlFile}`;
    
    console.log(`🚀 Starting markserv on port ${this.port} (livereload: ${this.livereloadPort})...`);
    console.log(`🌐 HTML will be served at: ${this.markservUrl}`);
    
    this.markservProcess = spawn('npx', ['markserv', '--port', this.port.toString(), '--silent', '--livereloadport', this.livereloadPort.toString()], {
      cwd: this.inputDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Wait for markserv to be ready
    await this.waitForMarkserv();
  }

  async waitForMarkserv(maxAttempts = 10) {
    const puppeteerBrowser = await puppeteer.launch({ 
      headless: 'new',
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await puppeteerBrowser.newPage();
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        console.log(`⏳ Checking if markserv is ready (attempt ${i + 1}/${maxAttempts})...`);
        await page.goto(this.markservUrl, { waitUntil: 'networkidle2', timeout: 5000 });
        await puppeteerBrowser.close();
        console.log('✅ Markserv is ready!');
        return true;
      } catch (error) {
        if (i === maxAttempts - 1) {
          await puppeteerBrowser.close();
          throw new Error(`Markserv not ready after ${maxAttempts} attempts`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async generatePDF() {
    console.log('📄 Generating PDF...');
    
    if (!fs.existsSync(this.inputFile)) {
      console.error(`❌ Markdown file not found: ${this.inputFile}`);
      return;
    }

    const browser = await puppeteer.launch({ 
      headless: 'new',
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 1600 });
      
      await page.goto(this.markservUrl, { 
        waitUntil: 'networkidle2',
        timeout: 10000 
      });
      
      await page.waitForTimeout(1000);
      
      await page.pdf({
        path: this.outputFile,
        format: 'Letter',
        printBackground: true,
        margin: { 
          top: '0.5in', 
          right: '0.5in', 
          bottom: '0.5in', 
          left: '0.5in' 
        },
        preferCSSPageSize: true,
      });
      
      console.log(`✅ PDF saved: ${this.outputFile}`);
      
    } catch (error) {
      console.error(`❌ PDF generation failed:`, error.message);
    } finally {
      await browser.close();
    }
  }

  async startWatching() {
    const toolIndexFile = path.join(this.toolDir, 'index.html');
    const toolStylesFile = path.join(this.toolDir, 'styles.css');
    const watchFiles = [this.inputFile, toolIndexFile, toolStylesFile];
    
    console.log(`👀 Watching for changes:`);
    console.log(`   📝 ${this.inputFile} (markdown content)`);
    console.log(`   🎨 ${toolStylesFile} (styles)`);
    console.log(`   📄 ${toolIndexFile} (template)`);
    console.log('   Press Ctrl+C to stop');
    
    const watcher = chokidar.watch(watchFiles, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });
    
    watcher.on('change', async (changedFile) => {
      const fileName = path.basename(changedFile);
      console.log(`\n📝 ${fileName} changed, regenerating PDF...`);
      
      // If template files changed, re-copy them to working directory
      if (changedFile === path.join(this.toolDir, 'index.html') || 
          changedFile === path.join(this.toolDir, 'styles.css')) {
        console.log('🔄 Updating template files...');
        await this.setupWorkingDirectory();
      }
      
      await this.generatePDF();
    });
    
    watcher.on('error', (error) => {
      console.error('❌ Watcher error:', error);
    });
  }

  cleanup() {
    // Kill markserv process
    if (this.markservProcess) {
      this.markservProcess.kill();
    }
    
    // Remove temporary files only if they're not in the tool directory
    if (this.inputDir !== this.toolDir) {
      const tempFiles = [
        path.join(this.inputDir, this.htmlFile),
        path.join(this.inputDir, 'styles.css')
      ];
      
      tempFiles.forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`🗑️  Removed: ${path.basename(file)}`);
        }
      });
      
      console.log('\n🧹 Cleaned up temporary files');
    } else {
      console.log('\n🧹 Skipped cleanup (working in tool directory)');
    }
  }

  async run() {
    try {
      console.log(`🎯 MarkPDF starting for: ${this.inputFile}`);
      
      await this.setupWorkingDirectory();
      await this.startMarkserv();
      await this.generatePDF();
      await this.startWatching();
      
    } catch (error) {
      console.error('❌ Failed to start:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  if (global.markpdfInstance) {
    global.markpdfInstance.cleanup();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  if (global.markpdfInstance) {
    global.markpdfInstance.cleanup();
  }
  process.exit(0);
});

// Export for CLI usage
module.exports = MarkPDF;

// If run directly
if (require.main === module) {
  const inputFile = process.argv[2];
  
  if (!inputFile) {
    console.error('Usage: node markpdf.js <markdown-file>');
    process.exit(1);
  }
  
  const markpdf = new MarkPDF(inputFile);
  global.markpdfInstance = markpdf;
  markpdf.run();
}
