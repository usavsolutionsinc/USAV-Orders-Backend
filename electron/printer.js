const { exec } = require('child_process');

/**
 * Send a file to the default system printer.
 *
 * macOS  — uses CUPS via `lp`
 * Windows — uses PowerShell's Start-Process with the Print verb
 *
 * @param {string} filePath Absolute path to the file to print
 * @returns {Promise<void>}
 */
function printFile(filePath) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;

    if (platform === 'darwin') {
      // CUPS print — works for PDF, DOCX (if converter installed), images, etc.
      exec(`lp "${filePath}"`, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
    } else if (platform === 'win32') {
      // PowerShell Shell.Application verb print — opens the registered handler
      const safe = filePath.replace(/'/g, "''");
      exec(
        `powershell -NoProfile -Command "Start-Process -FilePath '${safe}' -Verb Print -Wait"`,
        (err, _stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve();
        }
      );
    } else {
      reject(new Error(`Printing is not supported on platform: ${platform}`));
    }
  });
}

module.exports = { printFile };
