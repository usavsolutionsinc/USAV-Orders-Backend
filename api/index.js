const express = require('express');
const app = express();

app.get('/api', (req, res) => {
  res.send('Hello from Express on Vercel!');
});

module.exports = app;


