export type MediaUploadSource =
  | string
  | {
      uri: string;
      mimeType?: string | null;
      fileName?: string | null;
    };

export type MediaPlatform = "web" | "ios" | "android" | string;

export function mediaSourceUri(source: MediaUploadSource): string {
  return typeof source === "string" ? source : source.uri;
}

export function mediaSourceMimeType(
  source: MediaUploadSource
): string | null {
  return typeof source === "string"
    ? null
    : source.mimeType?.trim() || null;
}

/**
 * Load picker media into the Blob shape accepted by Firebase Storage.
 *
 * Expo ImagePicker 14 returns data URIs on web. Safari/WebKit can reject
 * fetch(data:) for larger local images and videos with only "Load failed", so
 * data URIs are decoded synchronously and never passed through fetch. Browser
 * blob/http URLs use fetch while native local-library URIs use XHR.
 */
export async function loadMediaBlob(
  source: MediaUploadSource,
  platform: MediaPlatform
): Promise<Blob> {
  const uri = mediaSourceUri(source).trim();
  const declaredMimeType = mediaSourceMimeType(source);
  if (!uri) throw new Error("No media file was selected.");

  if (uri.startsWith("data:")) {
    return dataUriToBlob(uri, declaredMimeType);
  }

  if (
    platform === "web" ||
    uri.startsWith("http://") ||
    uri.startsWith("https://") ||
    uri.startsWith("blob:")
  ) {
    try {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(`Media request returned HTTP ${response.status}.`);
      }
      return applyDeclaredMimeType(await response.blob(), declaredMimeType);
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "The browser could not load the selected file.";
      if (uri.startsWith("blob:")) {
        throw new Error(
          `The selected browser file is no longer available. Choose it again. ${detail}`
        );
      }
      throw new Error(`The browser could not load the selected media. ${detail}`);
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      const blob = xhr.response as Blob | null;
      if (!blob) {
        reject(new Error("Could not read the selected media file."));
        return;
      }
      resolve(applyDeclaredMimeType(blob, declaredMimeType));
    };
    xhr.onerror = () => reject(new Error("Could not read the selected media file."));
    xhr.onabort = () => reject(new Error("Reading the selected media was canceled."));
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });
}

function applyDeclaredMimeType(blob: Blob, declaredMimeType: string | null): Blob {
  return !blob.type && declaredMimeType
    ? blob.slice(0, blob.size, declaredMimeType)
    : blob;
}

export function dataUriToBlob(
  uri: string,
  declaredMimeType?: string | null
): Blob {
  const commaIndex = uri.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("The selected browser file has an invalid data URI.");
  }

  const header = uri.slice(5, commaIndex);
  const encoded = uri.slice(commaIndex + 1);
  const mimeType =
    header.split(";")[0] || declaredMimeType || "application/octet-stream";
  const isBase64 = header.split(";").includes("base64");

  if (!isBase64) {
    try {
      return new Blob([decodeURIComponent(encoded)], { type: mimeType });
    } catch {
      throw new Error("The selected browser file contains invalid encoded data.");
    }
  }

  let binary: string;
  try {
    binary = globalThis.atob(encoded);
  } catch {
    throw new Error("The selected browser file contains invalid base64 data.");
  }

  const chunkSize = 1024 * 1024;
  const parts: ArrayBuffer[] = [];
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, binary.length);
    const buffer = new ArrayBuffer(end - offset);
    const bytes = new Uint8Array(buffer);
    for (let index = offset; index < end; index += 1) {
      bytes[index - offset] = binary.charCodeAt(index);
    }
    parts.push(buffer);
  }
  return new Blob(parts, { type: mimeType });
}
