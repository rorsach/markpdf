const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

class MarkPDFChromium {
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
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', () => resolve(this.findAvailablePort(startPort + 1)));
      server.listen(startPort, () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });
  }

  async setupWorkingDirectory() {
    const indexTemplate = path.join(this.toolDir, 'index.html');
    const stylesTemplate = path.join(this.toolDir, 'styles.css');
    const workingIndex = path.join(this.inputDir, this.htmlFile);
    const workingStyles = path.join(this.inputDir, 'styles.css');

    if (!fs.existsSync(indexTemplate)) {
      throw new Error(`Template file not found: ${indexTemplate}`);
    }
    if (!fs.existsSync(stylesTemplate)) {
      throw new Error(`Template file not found: ${stylesTemplate}`);
    }

    let indexContent = fs.readFileSync(indexTemplate, 'utf8');
    indexContent = indexContent.replace('MARKDOWN_FILE', path.basename(this.inputFile));
    
    fs.writeFileSync(workingIndex, indexContent, 'utf8');
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

    await this.waitForMarkserv();
  }

  async waitForMarkserv(maxAttempts = 10, delay = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection({ port: this.port, host: 'localhost' }, () => {
            socket.end();
            resolve();
          });
          socket.on('error', (err) => reject(err));
        });
        console.log('✅ Markserv is ready!');
        return;
      } catch (error) {
        if (i === maxAttempts - 1) {
          throw new Error(`Markserv not ready after ${maxAttempts} attempts`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async generatePDF() {
    console.log('📄 Generating PDF using Chromium CLI...');
    
    if (!fs.existsSync(this.inputFile)) {
      console.error(`❌ Markdown file not found: ${this.inputFile}`);
      return;
    }

    const pdfOutputPath = path.join(this.inputDir, `${this.inputBasename}.pdf`);
    const command = 'chromium';
    const args = [
      '--headless',
      `--print-to-pdf=${pdfOutputPath}`,
      '--no-pdf-header-footer',
      this.markservUrl
    ];

    return new Promise((resolve, reject) => {
      const chromiumProcess = spawn(command, args);

      chromiumProcess.stdout.on('data', (data) => {
        console.log(`[Chromium]: ${data}`);
      });

      chromiumProcess.stderr.on('data', (data) => {
        console.error(`[Chromium]: ${data}`);
      });

      chromiumProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ PDF saved: ${this.outputFile}`);
          resolve();
        } else {
          console.error(`❌ PDF generation failed with exit code ${code}`);
          reject(new Error(`Chromium process exited with code ${code}`));
        }
      });
    });
  }

  async startWatching() {
    const workingStyles = path.join(this.inputDir, 'styles.css');
    const workingIndex = path.join(this.inputDir, this.htmlFile);
    const watchFiles = [this.inputFile, workingStyles, workingIndex];
    
    console.log(`👀 Watching for changes:`);
    console.log(`   📝 ${this.inputFile} (markdown content)`);
    console.log(`   🎨 ${workingStyles} (styles)`);
    console.log(`   📄 ${workingIndex} (template)`);
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
      await this.generatePDF();
    });
    
    watcher.on('error', (error) => {
      console.error('❌ Watcher error:', error);
    });
  }

  cleanup() {
    if (this.markservProcess) {
      this.markservProcess.kill();
    }
    
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
      console.log(`🎯 MarkPDF-Chromium starting for: ${this.inputFile}`);
      
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

if (require.main === module) {
  const inputFile = process.argv[2];
  
  if (!inputFile) {
    console.error('Usage: node markpdf-chromium.js <markdown-file>');
    process.exit(1);
  }
  
  const markpdf = new MarkPDFChromium(inputFile);
  global.markpdfInstance = markpdf;
  markpdf.run();
}