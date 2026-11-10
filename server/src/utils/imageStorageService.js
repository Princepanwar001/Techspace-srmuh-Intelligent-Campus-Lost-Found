import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LOCAL_UPLOADS_ROOT = path.resolve(
  __dirname,
  "../../uploads/items"
);

export const ALLOWED_IMAGE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_IMAGES_PER_ITEM = 5;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const MIME_TO_EXTENSION = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

let customStorageAdapterForTests = null;

export function setCloudStorageAdapterForTests(adapter) {
  customStorageAdapterForTests =
    typeof adapter === "object" && adapter !== null ? adapter : null;
}

export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
      process.env.CLOUDINARY_API_KEY?.trim() &&
      process.env.CLOUDINARY_API_SECRET?.trim()
  );
}

export function isCloudStorageConfigured() {
  if (customStorageAdapterForTests) {
    if (customStorageAdapterForTests.simulateUnconfigured === true) {
      return false;
    }
    return true;
  }
  if (
    String(process.env.STORAGE_PROVIDER || "")
      .trim()
      .toLowerCase() === "cloudinary"
  ) {
    return isCloudinaryConfigured();
  }
  return true;
}

function normalizeDeclaredMime(rawMime = "", fileName = "") {
  const lower = String(rawMime || "")
    .trim()
    .toLowerCase();
  if (lower === "image/jpg" || lower === "image/pjpeg") {
    return "image/jpeg";
  }
  if (lower && lower !== "application/octet-stream") {
    return lower;
  }

  const ext = path
    .extname(String(fileName || ""))
    .toLowerCase()
    .replace(/^\./, "");
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return lower;
}

/**
 * Inspect actual binary magic bytes to detect real image format.
 * Never rely solely on client-supplied file extensions or Content-Type headers.
 */
export function detectImageMimeTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: "RIFF" (52 49 46 46) at 0..3 and "WEBP" (57 45 42 50) at 8..11
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Strip EXIF, GPS, XMP, and text metadata chunks from JPEG, PNG, and WebP buffers
 * to prevent accidental disclosure of device location or personal camera metadata.
 */
export function stripImageMetadata(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return buffer;
  }

  try {
    if (mimeType === "image/jpeg") {
      return stripJpegExif(buffer);
    }
    if (mimeType === "image/png") {
      return stripPngMetadata(buffer);
    }
    if (mimeType === "image/webp") {
      return stripWebpMetadata(buffer);
    }
  } catch {
    // Fall back to original validated buffer if a non-standard container layout is encountered
  }
  return buffer;
}

function stripJpegExif(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return buffer;
  }

  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      // Reached compressed entropy-coded scan data
      chunks.push(buffer.subarray(offset));
      break;
    }

    // Skip padding 0xFF bytes
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buffer.length) break;

    const marker = buffer[offset];
    offset += 1;

    // Standalone markers without length (RST0-RST7, SOI, EOI, TEM)
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      chunks.push(Buffer.from([0xff, marker]));
      if (marker === 0xd9) break;
      continue;
    }

    // SOS (Start of Scan, 0xDA): copy rest of stream until EOI
    if (marker === 0xda) {
      chunks.push(Buffer.from([0xff, marker]));
      chunks.push(buffer.subarray(offset));
      break;
    }

    if (offset + 2 > buffer.length) {
      chunks.push(Buffer.from([0xff, marker]));
      chunks.push(buffer.subarray(offset));
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      chunks.push(Buffer.from([0xff, marker]));
      chunks.push(buffer.subarray(offset));
      break;
    }

    // Strip APP1 (0xE1: EXIF / XMP), APP13 (0xED: IPTC), and COM (0xFE: comments)
    const isMetadataSegment =
      marker === 0xe1 || marker === 0xed || marker === 0xfe;

    if (!isMetadataSegment) {
      chunks.push(Buffer.from([0xff, marker]));
      chunks.push(buffer.subarray(offset, offset + segmentLength));
    }

    offset += segmentLength;
  }

  return Buffer.concat(chunks);
}

function stripPngMetadata(buffer) {
  const pngSig = buffer.subarray(0, 8);
  const chunks = [pngSig];
  let offset = 8;

  const strippedChunkTypes = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const totalChunkSize = 4 + 4 + length + 4; // length + type + data + CRC

    if (offset + totalChunkSize > buffer.length) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    if (!strippedChunkTypes.has(type)) {
      chunks.push(buffer.subarray(offset, offset + totalChunkSize));
    }

    offset += totalChunkSize;
    if (type === "IEND") break;
  }

  return Buffer.concat(chunks);
}

function stripWebpMetadata(buffer) {
  const keptChunks = [];
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const fourCC = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const paddedSize = chunkSize + (chunkSize % 2);
    const totalChunkBytes = 8 + paddedSize;

    if (offset + totalChunkBytes > buffer.length) {
      keptChunks.push(buffer.subarray(offset));
      break;
    }

    if (fourCC !== "EXIF" && fourCC !== "XMP ") {
      keptChunks.push(buffer.subarray(offset, offset + totalChunkBytes));
    }

    offset += totalChunkBytes;
  }

  const body = Buffer.concat(keptChunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WEBP", 8, "ascii");

  return Buffer.concat([header, body]);
}

export function generateSafeImagePublicId(itemId) {
  const cleanItemId = String(itemId || "item").replace(/[^a-zA-Z0-9_-]/g, "");
  const randHex = crypto.randomBytes(8).toString("hex");
  const folder = (process.env.CLOUDINARY_UPLOAD_FOLDER || "lostlink/items")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return `${folder}/${cleanItemId}/${Date.now()}-${randHex}`;
}

/**
 * Parse and validate a single incoming image candidate from either multipart or JSON payload.
 */
export function validateAndPrepareImageInput(rawImage) {
  if (!rawImage || typeof rawImage !== "object") {
    return { valid: false, status: 400, message: "Invalid image payload" };
  }

  const rawVisibility =
    typeof rawImage.visibility === "string"
      ? rawImage.visibility.trim().toUpperCase()
      : "PUBLIC";

  if (rawVisibility !== "PUBLIC" && rawVisibility !== "PRIVATE") {
    return {
      valid: false,
      status: 400,
      message: "Image visibility must be PUBLIC or PRIVATE",
    };
  }

  let declaredMime = normalizeDeclaredMime(
    rawImage.mimeType,
    rawImage.fileName || rawImage.name || ""
  );

  let buffer = null;

  if (Buffer.isBuffer(rawImage.buffer)) {
    buffer = rawImage.buffer;
  } else if (typeof rawImage.dataUrl === "string") {
    const trimmedUrl = rawImage.dataUrl.trim();
    const commaIdx = trimmedUrl.indexOf(",");
    if (commaIdx === -1) {
      return {
        valid: false,
        status: 400,
        message: "Malformed image data URL",
      };
    }
    const headerPart = trimmedUrl.slice(0, commaIdx);
    const bodyPart = trimmedUrl.slice(commaIdx + 1).replace(/\s+/g, "");
    const headerMatch = headerPart.match(/^data:([^;,]+);base64$/i);
    if (!headerMatch || !bodyPart || /[^A-Za-z0-9+/=]/.test(bodyPart)) {
      return {
        valid: false,
        status: 400,
        message: "Malformed image data URL",
      };
    }
    const dataUrlMime = normalizeDeclaredMime(headerMatch[1]);
    if (!declaredMime) {
      declaredMime = dataUrlMime;
    } else if (dataUrlMime && declaredMime !== dataUrlMime) {
      return {
        valid: false,
        status: 400,
        message:
          "File content signature does not match declared MIME type (JPEG, PNG, or WebP required)",
      };
    }
    buffer = Buffer.from(bodyPart, "base64");
  } else if (typeof rawImage.base64Data === "string") {
    const trimmed = rawImage.base64Data.trim().replace(/\s+/g, "");
    if (!trimmed || /[^A-Za-z0-9+/=]/.test(trimmed)) {
      return {
        valid: false,
        status: 400,
        message: "Malformed base64 image data",
      };
    }
    buffer = Buffer.from(trimmed, "base64");
  } else {
    return {
      valid: false,
      status: 400,
      message: "Image binary content is required",
    };
  }

  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      status: 400,
      message: "Image file cannot be empty",
    };
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      status: 400,
      message: "Image exceeds the maximum allowed size of 5 MB per photo",
    };
  }

  const detectedMime = detectImageMimeTypeFromBuffer(buffer);
  if (!declaredMime && detectedMime) {
    declaredMime = detectedMime;
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(declaredMime)) {
    return {
      valid: false,
      status: 400,
      message: "Unsupported image MIME type. Allowed types: JPEG, PNG, WebP",
    };
  }

  if (!detectedMime || detectedMime !== declaredMime) {
    return {
      valid: false,
      status: 400,
      message:
        "File content signature does not match declared MIME type (JPEG, PNG, or WebP required)",
    };
  }

  const sanitizedBuffer = stripImageMetadata(buffer, detectedMime);

  return {
    valid: true,
    buffer: sanitizedBuffer,
    mimeType: detectedMime,
    sizeBytes: sanitizedBuffer.length,
    visibility: rawVisibility,
  };
}

/**
 * Create and verify HMAC-SHA256 access tokens for PRIVATE ownership images
 * served via /api/items/media/:itemId/:fileName so non-owners cannot view them.
 */
export function createPrivateImageAccessToken(itemId, publicId) {
  const secret = process.env.JWT_SECRET || "lostlink-media-fallback-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`private-media:${String(itemId)}:${String(publicId)}`)
    .digest("hex");
}

export function verifyPrivateImageAccessToken(itemId, publicId, token) {
  if (!token || typeof token !== "string") return false;
  const expected = createPrivateImageAccessToken(itemId, publicId);
  if (token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}

/**
 * Upload a validated, EXIF-stripped image buffer to Cloudinary (when configured),
 * test adapter (during tests), or persistent local disk storage (`server/uploads/items`).
 */
export async function uploadImageToCloud({
  buffer,
  mimeType,
  itemId,
  visibility = "PUBLIC",
  uploadedBy,
  baseUrl = "",
}) {
  const publicId = generateSafeImagePublicId(itemId);

  if (customStorageAdapterForTests) {
    if (customStorageAdapterForTests.simulateUnconfigured === true) {
      const err = new Error(
        "Cloud image storage is not configured on the server"
      );
      err.code = "STORAGE_NOT_CONFIGURED";
      throw err;
    }
    if (typeof customStorageAdapterForTests.uploadImage !== "function") {
      throw new Error("Storage service unavailable");
    }
    const result = await customStorageAdapterForTests.uploadImage({
      buffer,
      mimeType,
      publicId,
      itemId,
      visibility,
      uploadedBy,
    });
    if (!result || !result.url || !result.publicId) {
      throw new Error("Invalid response from cloud storage provider");
    }
    return {
      url: result.url,
      publicId: result.publicId,
      visibility,
      mimeType,
      sizeBytes: buffer.length,
      uploadedBy,
      createdAt: new Date(),
    };
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (cloudName && apiKey && apiSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    // Sign parameters in alphabetical order: public_id, timestamp
    const signaturePayload = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto
      .createHash("sha1")
      .update(signaturePayload)
      .digest("hex");

    const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const formData = new FormData();
    formData.append("file", dataUri);
    formData.append("api_key", apiKey);
    formData.append("timestamp", String(timestamp));
    formData.append("public_id", publicId);
    formData.append("signature", signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(
        cloudName
      )}/image/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.secure_url || !data?.public_id) {
      const err = new Error(
        data?.error?.message || "Cloud storage provider rejected the upload"
      );
      err.code = "STORAGE_PROVIDER_ERROR";
      throw err;
    }

    return {
      url: data.secure_url,
      publicId: data.public_id,
      visibility,
      mimeType,
      sizeBytes: buffer.length,
      uploadedBy,
      createdAt: new Date(),
    };
  }

  if (
    String(process.env.STORAGE_PROVIDER || "")
      .trim()
      .toLowerCase() === "cloudinary"
  ) {
    const err = new Error(
      "Cloud image storage is not configured on the server"
    );
    err.code = "STORAGE_NOT_CONFIGURED";
    throw err;
  }

  // Persistent local disk storage fallback when external Cloudinary credentials are not set
  const safeItemId = String(itemId || "item").replace(/[^a-zA-Z0-9_-]/g, "");
  const ext = MIME_TO_EXTENSION[mimeType] || "jpg";
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const itemDir = path.join(LOCAL_UPLOADS_ROOT, safeItemId);

  await fs.promises.mkdir(itemDir, { recursive: true });
  const filePath = path.join(itemDir, fileName);
  await fs.promises.writeFile(filePath, buffer);

  const resolvedOrigin = (
    baseUrl ||
    process.env.PUBLIC_SERVER_URL ||
    `http://localhost:${process.env.PORT || 5000}`
  ).replace(/\/+$/, "");

  const localPublicId = `local/items/${safeItemId}/${fileName}`;
  const localUrl = `${resolvedOrigin}/api/items/media/${safeItemId}/${fileName}`;

  return {
    url: localUrl,
    publicId: localPublicId,
    visibility,
    mimeType,
    sizeBytes: buffer.length,
    uploadedBy,
    createdAt: new Date(),
  };
}

/**
 * Read a locally stored image buffer safely (preventing path traversal).
 */
export async function readLocalImageFile(itemId, fileName) {
  const safeItemId = String(itemId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const safeFileName = path.basename(String(fileName || ""));
  if (
    !safeItemId ||
    !safeFileName ||
    safeFileName !== fileName ||
    !/^[a-zA-Z0-9._-]+$/.test(safeFileName)
  ) {
    return null;
  }

  const targetPath = path.join(LOCAL_UPLOADS_ROOT, safeItemId, safeFileName);
  const normalizedRoot = path.resolve(LOCAL_UPLOADS_ROOT);
  const normalizedTarget = path.resolve(targetPath);
  if (!normalizedTarget.startsWith(normalizedRoot + path.sep)) {
    return null;
  }

  try {
    return await fs.promises.readFile(normalizedTarget);
  } catch {
    return null;
  }
}

/**
 * Delete an asset from Cloudinary, test adapter, or local disk storage
 * when an image or item report is deleted/moderated.
 */
export async function deleteImageFromCloud(publicId) {
  if (!publicId || typeof publicId !== "string") {
    return { deleted: false };
  }

  if (customStorageAdapterForTests) {
    if (typeof customStorageAdapterForTests.deleteImage === "function") {
      return await customStorageAdapterForTests.deleteImage(publicId);
    }
    return { deleted: true };
  }

  if (publicId.startsWith("local/items/")) {
    const parts = publicId.split("/");
    const safeItemId = (parts[2] || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const safeFileName = path.basename(parts[3] || "");
    if (safeItemId && safeFileName) {
      const targetPath = path.join(LOCAL_UPLOADS_ROOT, safeItemId, safeFileName);
      try {
        await fs.promises.unlink(targetPath);
        return { deleted: true };
      } catch {
        return { deleted: false };
      }
    }
    return { deleted: false };
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    return { deleted: false, reason: "STORAGE_NOT_CONFIGURED" };
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signaturePayload = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto
      .createHash("sha1")
      .update(signaturePayload)
      .digest("hex");

    const formData = new FormData();
    formData.append("public_id", publicId);
    formData.append("api_key", apiKey);
    formData.append("timestamp", String(timestamp));
    formData.append("signature", signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(
        cloudName
      )}/image/destroy`,
      {
        method: "POST",
        body: formData,
      }
    );
    const data = await response.json().catch(() => null);
    return { deleted: response.ok && data?.result === "ok" };
  } catch (error) {
    console.error("Cloud asset cleanup error:", error.message);
    return { deleted: false };
  }
}

export async function deleteMultipleImagesFromCloud(images = []) {
  if (!Array.isArray(images) || images.length === 0) return;
  await Promise.allSettled(
    images
      .filter((img) => img && typeof img.publicId === "string")
      .map((img) => deleteImageFromCloud(img.publicId))
  );
}

/**
 * Parse multipart/form-data buffer into image file entries and text fields
 * without requiring external multer dependencies.
 */
export function parseMultipartImagePayload(rawBuffer, contentTypeHeader = "") {
  if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
    return { files: [], fields: {} };
  }

  const boundaryMatch = contentTypeHeader.match(
    /boundary=(?:"([^"]+)"|([^;,\s]+))/i
  );
  const boundary = boundaryMatch ? boundaryMatch[1] || boundaryMatch[2] : null;
  if (!boundary) {
    return { files: [], fields: {} };
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const crlfDouble = Buffer.from("\r\n\r\n");
  const files = [];
  const fields = {};

  let start = rawBuffer.indexOf(delimiter);
  while (start !== -1) {
    const nextStart = rawBuffer.indexOf(delimiter, start + delimiter.length);
    if (nextStart === -1) break;

    let part = rawBuffer.subarray(start + delimiter.length, nextStart);
    if (part.subarray(0, 2).toString() === "\r\n") {
      part = part.subarray(2);
    }
    if (part.subarray(part.length - 2).toString() === "\r\n") {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(crlfDouble);
    if (headerEnd !== -1) {
      const rawHeaders = part.subarray(0, headerEnd).toString("utf8");
      const contentBuffer = part.subarray(headerEnd + 4);

      const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
      const filenameMatch = rawHeaders.match(/filename="([^"]*)"/i);
      const typeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);

      const fieldName = nameMatch ? nameMatch[1] : "";
      if (filenameMatch) {
        files.push({
          fieldName,
          fileName: filenameMatch[1],
          mimeType: typeMatch ? typeMatch[1].trim().toLowerCase() : "",
          buffer: contentBuffer,
        });
      } else if (fieldName) {
        const val = contentBuffer.toString("utf8").trim();
        if (fields[fieldName] === undefined) {
          fields[fieldName] = val;
        } else if (Array.isArray(fields[fieldName])) {
          fields[fieldName].push(val);
        } else {
          fields[fieldName] = [fields[fieldName], val];
        }
      }
    }

    start = nextStart;
  }

  return { files, fields };
}
