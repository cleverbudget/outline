import invariant from "invariant";
import { AttachmentPreset } from "@shared/types";
import { client } from "./ApiClient";
import Logger from "./Logger";

type UploadOptions = {
  /** The user facing name of the file */
  name?: string;
  /** The document that this file was uploaded in, if any */
  documentId?: string;
  /** The preset to use for attachment configuration */
  preset: AttachmentPreset;
  /** Callback will be passed a number between 0-1 as upload progresses */
  onProgress?: (fractionComplete: number) => void;
};

/**
 * Upload a file from a URL
 *
 * @param url The remote URL to download the file from
 * @param options The upload options
 * @returns The attachment object
 */
export const uploadFileFromUrl = async (
  url: string,
  options: UploadOptions
) => {
  const response = await client.post("/attachments.createFromUrl", {
    documentId: options.documentId,
    url,
  });
  return response.data;
};

/**
 * Upload a file
 *
 * @param file The file to upload
 * @param options The upload options
 * @returns The attachment object
 */
export const uploadFile = async (
  file: File | Blob,
  options: UploadOptions = {
    name: "",
    preset: AttachmentPreset.DocumentAttachment,
  }
) => {
  console.log("🔍 Step 1: Starting file upload");
  console.log("File:", file instanceof File ? file.name : "Blob");
  console.log("Size:", file.size);
  console.log("Type:", file.type);
  
  const name = file instanceof File ? file.name : options.name;
  console.log("📤 Step 2: Creating attachment via API");
  
  const response = await client.post("/attachments.create", {
    preset: options.preset,
    documentId: options.documentId,
    contentType: file.type,
    size: file.size,
    name,
  });
  
  console.log("📥 Step 2: API response received");
  console.log("Response status:", response?.status);
  
  invariant(response, "Response should be available");
  const data = response.data;
  const attachment = data.attachment;
  const formData = new FormData();

  console.log("📤 Step 3: Preparing upload to storage");
  console.log("Upload URL:", data.uploadUrl);
  console.log("Form fields:", Object.keys(data.form));

  for (const key in data.form) {
    formData.append(key, data.form[key]);
  }

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'blob' does not exist on type 'File | Blo... Remove this comment to see the full error message
  if (file.blob) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'file' does not exist on type 'File | Blo... Remove this comment to see the full error message
    formData.append("file", file.file);
  } else {
    formData.append("file", file);
  }

  // Using XMLHttpRequest instead of fetch because fetch doesn't support progress
  const xhr = new XMLHttpRequest();
  const success = await new Promise((resolve) => {
    console.log("🚀 Step 3: Starting upload to storage");
    
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && options.onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        console.log(`📊 Step 3: Upload progress: ${percent}%`);
        options.onProgress(event.loaded / event.total);
      }
    });
    
    xhr.addEventListener("error", () => {
      console.error("❌ Step 3: Upload failed");
      console.error("Status:", xhr.status);
      console.error("Status Text:", xhr.statusText);
      console.error("Response:", xhr.responseText);
      Logger.error(
        "File upload failed",
        new Error(`${xhr.status} ${xhr.statusText}`)
      );
    });
    
    xhr.addEventListener("load", () => {
      console.log("✅ Step 3: Upload completed successfully");
      console.log("Status:", xhr.status);
      console.log("Response Headers:", xhr.getAllResponseHeaders());
    });
    
    xhr.addEventListener("loadend", () => {
      const success = xhr.readyState === 4 && xhr.status >= 200 && xhr.status < 400;
      console.log(`🎯 Step 3: Upload ${success ? 'succeeded' : 'failed'}`);
      resolve(success);
    });
    
    xhr.open("POST", data.uploadUrl, true);
    console.log("📤 Step 3: Sending request to:", data.uploadUrl);
    xhr.send(formData);
  });

  if (!success) {
    console.error("💥 Upload failed - throwing error");
    throw new Error("Upload failed");
  }

  console.log("🎉 Upload completed successfully!");
  return attachment;
};

/**
 * Convert a data URL to a Blob
 *
 * @param dataURL The data URL to convert
 * @returns The Blob
 */
export const dataUrlToBlob = (dataURL: string) => {
  const blobBin = atob(dataURL.split(",")[1]);
  const array = [];

  for (let i = 0; i < blobBin.length; i++) {
    array.push(blobBin.charCodeAt(i));
  }

  const file = new Blob([new Uint8Array(array)], {
    type: "image/png",
  });
  return file;
};

const CHAR_FORWARD_SLASH = 47; /* / */
const CHAR_DOT = 46; /* . */

// Based on the NodeJS Library https://github.com/nodejs/node/blob/896b75a4da58a7283d551c4595e0aa454baca3e0/lib/path.js
// Copyright Joyent, Inc. and other Node contributors.
export const extname = (path: string) => {
  if (typeof path !== "string") {
    throw new TypeError(
      `The "path" argument must be of type string. Received type ${typeof path}`
    );
  }

  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === CHAR_FORWARD_SLASH) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return path.slice(startDot, end);
};
