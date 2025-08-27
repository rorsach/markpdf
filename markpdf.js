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

    if (fs.existsSync(workingIndex)) {
      console.log(`⚠️  Warning: ${this.htmlFile} already exists, skipping creation.`);
    } else {
      let indexContent = fs.readFileSync(indexTemplate, 'utf8');
      indexContent = indexContent.replace('MARKDOWN_FILE', path.basename(this.inputFile));
      fs.writeFileSync(workingIndex, indexContent, 'utf8');
      console.log(`   📄 Created ${this.htmlFile} (HTML wrapper)`);
    }

    if (fs.existsSync(workingStyles)) {
      console.log(`⚠️  Warning: styles.css already exists, skipping creation.`);
    } else {
      fs.copyFileSync(stylesTemplate, workingStyles);
      console.log(`   🎨 Created styles.css (PDF styles)`);
    }
  }

  async startMarkserv() {
    this.port = await this.findAvailablePort();
    this.livereloadPort = await this.findAvailablePort(35729);
    this.markservUrl = `http://localhost:${this.port}/${this.htmlFile}`;
    
    console.log(`🚀 Starting markserv on port ${this.port} (livereload: ${this.livereloadPort})...`);
    console.log(`🌐 HTML will be served at: ${this.markservUrl}`);
    
      this.markservProcess = spawn('npx', ['markserv', '--port', this.port.toString(), '--no-browser', '--silent', '--livereloadport', this.livereloadPort.toString()], {
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
          this.stripAndInjectMetadata(pdfOutputPath).then(resolve).catch(reject);
        } else {
          console.error(`❌ PDF generation failed with exit code ${code}`);
          reject(new Error(`Chromium process exited with code ${code}`));
        }
      });
    });
  }

  async stripAndInjectMetadata(pdfOutputPath) {
    return new Promise((resolve, reject) => {
      console.log('🔧 Cleaning PDF metadata with MuPDF mutool...');
      
      // Use mutool clean to rewrite the PDF and strip metadata
      const tempOutputPath = pdfOutputPath.replace('.pdf', '_cleaned.pdf');
      const mutoolArgs = [
        'clean',
        '-d',  // Remove duplicate objects
        '-s',  // Sanitize content streams
        '-z',  // Compress streams
        pdfOutputPath,
        tempOutputPath
      ];

      const mutoolProcess = spawn('mutool', mutoolArgs);

      mutoolProcess.on('error', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('⚠️  Warning: `mutool` not found. Falling back to mat2...');
          console.warn('   To install MuPDF on Debian/Ubuntu, run: sudo apt-get install mupdf-tools');
          this.fallbackMat2(pdfOutputPath).then(resolve).catch(reject);
        } else {
          console.error('❌ mutool error:', err);
          reject(err);
        }
      });

      mutoolProcess.on('close', (code) => {
        if (code === 0) {
          // Replace original with cleaned version
          const fs = require('fs');
          try {
            fs.renameSync(tempOutputPath, pdfOutputPath);
            console.log('✅ PDF cleaned with mutool.');
            this.injectMetadata(pdfOutputPath).then(resolve).catch(reject);
          } catch (renameError) {
            console.error('❌ Failed to replace original PDF:', renameError);
            this.fallbackMat2(pdfOutputPath).then(resolve).catch(reject);
          }
        } else {
          console.warn('⚠️  mutool failed, falling back to mat2...');
          // Clean up temp file if it exists
          const fs = require('fs');
          if (fs.existsSync(tempOutputPath)) {
            fs.unlinkSync(tempOutputPath);
          }
          this.fallbackMat2(pdfOutputPath).then(resolve).catch(reject);
        }
      });
    });
  }

  async fallbackMat2(pdfOutputPath) {
    return new Promise((resolve, reject) => {
      console.log('✨ Stripping PDF metadata with mat2...');
      const mat2Process = spawn('mat2', ['--lightweight', '--inplace', pdfOutputPath]);

      mat2Process.on('error', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('⚠️  Warning: `mat2` not found. Skipping metadata stripping.');
          console.warn('   To install, run: pip install mat2');
          this.injectMetadata(pdfOutputPath).then(resolve).catch(reject);
        } else {
          console.error('❌ mat2 error:', err);
          reject(err);
        }
      });

      mat2Process.on('close', (mat2Code) => {
        if (mat2Code === 0) {
          console.log('✅ Metadata stripped successfully.');
          this.injectMetadata(pdfOutputPath).then(resolve).catch(reject);
        } else if (mat2Code !== null) {
          console.error(`❌ mat2 failed with exit code ${mat2Code}.`);
          this.injectMetadata(pdfOutputPath).then(resolve).catch(reject);
        }
      });
    });
  }

  async injectMetadata(pdfOutputPath) {
    return new Promise((resolve, reject) => {
      const metadataFile = path.join(this.inputDir, `${this.inputBasename}-metadata.md`);
      if (!fs.existsSync(metadataFile)) {
        console.log('ℹ️ No metadata file found, skipping metadata injection.');
        return resolve();
      }

      console.log(`Injecting metadata from ${metadataFile}...`);
      const metadataContent = fs.readFileSync(metadataFile, 'utf8');
      const exiftoolArgs = [];
      metadataContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          const value = valueParts.join(':').trim();
          exiftoolArgs.push(`-${key}=${value}`);
        }
      });

      if (exiftoolArgs.length === 0) {
        console.log('No valid metadata found in file.');
        return resolve();
      }

      exiftoolArgs.push('-overwrite_original', pdfOutputPath);
      const exiftoolProcess = spawn('exiftool', exiftoolArgs);

      exiftoolProcess.on('error', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('⚠️  Warning: `exiftool` not found. Skipping metadata injection.');
          console.warn('   To install on Debian/Ubuntu, run: sudo apt-get install libimage-exiftool-perl');
          resolve();
        } else {
          console.error('❌ Exiftool error:', err);
          reject(err);
        }
      });

      exiftoolProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Metadata injected successfully.');
          resolve();
        } else if (code !== null) {
          console.error(`❌ Exiftool failed with exit code ${code}.`);
          reject(new Error(`Exiftool process exited with code ${code}`));
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
      const filesToCheck = [
        {
          target: path.join(this.inputDir, this.htmlFile),
          template: path.join(this.toolDir, 'index.html'),
          isTemplate: true
        },
        {
          target: path.join(this.inputDir, 'styles.css'),
          template: path.join(this.toolDir, 'styles.css'),
          isTemplate: false
        }
      ];
      
      filesToCheck.forEach(({ target, template, isTemplate }) => {
        if (fs.existsSync(target) && fs.existsSync(template)) {
          const targetContent = fs.readFileSync(target, 'utf8');
          let templateContent = fs.readFileSync(template, 'utf8');
          
          // For HTML template, we need to account for the MARKDOWN_FILE substitution
          if (isTemplate) {
            templateContent = templateContent.replace('MARKDOWN_FILE', path.basename(this.inputFile));
          }
          
          if (targetContent === templateContent) {
            fs.unlinkSync(target);
            console.log(`🗑️  Removed: ${path.basename(target)} (unchanged from template)`);
          } else {
            console.log(`💾 Preserved: ${path.basename(target)} (contains customizations)`);
          }
        }
      });
      
      console.log('\n🧹 Cleanup complete');
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
