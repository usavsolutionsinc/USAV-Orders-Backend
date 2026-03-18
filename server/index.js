const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// printer.js lives one level up in the electron/ folder
const { printFile } = require('../electron/printer');

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// File storage — uploaded .docx files land in server/storage/
// ---------------------------------------------------------------------------
const STORAGE_DIR = path.join(__dirname, 'storage');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    cb(null, STORAGE_DIR);
  },
  filename: (_req, file, cb) => {
    // Prefix with timestamp so filenames are unique across uploads
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/pdf',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(docx?|pdf)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .doc, .docx, and .pdf files are accepted'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Upload a file; returns the server-side path needed to call /print */
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received' });
  }
  const filePath = path.resolve(req.file.path);
  res.json({ success: true, filePath, fileName: req.file.originalname });
});

/** Trigger native OS printing for a previously uploaded file */
app.post('/print', async (req, res) => {
  const { filePath } = req.body ?? {};
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  // Security: only allow paths that live inside our storage directory
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(STORAGE_DIR)) {
    return res.status(403).json({ error: 'Path is outside the allowed storage directory' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    await printFile(resolved);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** List files currently in storage */
app.get('/files', (_req, res) => {
  const files = fs.existsSync(STORAGE_DIR)
    ? fs.readdirSync(STORAGE_DIR).map((name) => ({
        name,
        path: path.join(STORAGE_DIR, name),
        size: fs.statSync(path.join(STORAGE_DIR, name)).size,
        createdAt: fs.statSync(path.join(STORAGE_DIR, name)).birthtime,
      }))
    : [];
  res.json({ files });
});

/** Delete a file from storage */
app.delete('/files/:filename', (req, res) => {
  const filePath = path.join(STORAGE_DIR, path.basename(req.params.filename));
  if (!filePath.startsWith(STORAGE_DIR)) {
    return res.status(403).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

/** Serve stored files so the renderer can preview them */
app.use('/files', express.static(STORAGE_DIR));

/** Health check */
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------
function startServer(port = 3001) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`[sidecar] Local API running on http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { startServer, app };
