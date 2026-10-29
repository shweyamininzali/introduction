import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const imagesDirectory = resolve(root, "images");
const messages = [];
const maxBodyBytes = 10_000;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) {
    throw new RequestError(413, "Request body is too large.");
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseMessage(body, contentType) {
  let data;
  try {
    if (contentType === "application/json") {
      data = JSON.parse(body);
    } else if (contentType === "application/x-www-form-urlencoded") {
      data = Object.fromEntries(new URLSearchParams(body));
    } else {
      throw new RequestError(415, "Use JSON or URL-encoded form data.");
    }
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, "The request body is not valid.");
  }

  if (
    data === null
    || typeof data !== "object"
    || Array.isArray(data)
    || typeof data.name !== "string"
    || typeof data.message !== "string"
    || !data.name.trim()
    || !data.message.trim()
    || data.name.length > 100
    || data.message.length > 2000
  ) {
    throw new RequestError(400, "Enter a name (up to 100 characters) and a message (up to 2000 characters).");
  }

  return {
    name: data.name.trim(),
    message: data.message.trim(),
    receivedAt: new Date().toISOString()
  };
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function serveStatic(pathname, response) {
  let filePath;
  try {
    filePath = pathname === "/"
      ? resolve(root, "index.html")
      : resolve(imagesDirectory, decodeURIComponent(pathname.slice("/images/".length)));
  } catch (error) {
    if (error instanceof URIError) {
      response.writeHead(400);
      response.end("Invalid path.");
      return;
    }
    throw error;
  }

  if (pathname !== "/" && !filePath.startsWith(`${imagesDirectory}${sep}`)) {
    response.writeHead(400);
    response.end("Invalid path.");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404);
      response.end("Not found.");
      return;
    }
    throw error;
  }
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;

  if (request.method === "POST" && pathname === "/messages") {
    try {
      const body = await readRequestBody(request);
      const contentType = (request.headers["content-type"] ?? "").split(";")[0].trim();
      const message = parseMessage(body, contentType);
      messages.push(message);
      sendJson(response, 201, { received: true });
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error("Could not save message:", error);
      sendJson(response, 500, { error: "The message could not be saved." });
    }
    return;
  }

  if (request.method === "GET" && (pathname === "/" || pathname.startsWith("/images/"))) {
    try {
      await serveStatic(pathname, response);
    } catch (error) {
      console.error("Could not serve request:", error);
      response.writeHead(500);
      response.end("Unable to serve this page.");
    }
    return;
  }

  response.writeHead(404);
  response.end("Not found.");
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Portfolio available at http://localhost:${port}`);
});
