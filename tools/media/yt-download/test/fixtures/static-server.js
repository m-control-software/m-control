'use strict';

/**
 * Serves the files in argv[2] over HTTP on a free port and prints the port.
 * Runs as its own process because runTool blocks the test's event loop.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = process.argv[2];

http
  .createServer((req, res) => {
    const file = path.join(root, path.basename(decodeURIComponent(req.url)));
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-length': data.length }).end(data);
    });
  })
  .listen(0, '127.0.0.1', function () {
    process.stdout.write(`${this.address().port}\n`);
  });
