import { ApiError } from "./api";
import type { Attachment, TaskBrief } from "./intake-types";

export const emptyBrief = (): TaskBrief => ({
  acceptanceCriteria: "",
  scope: "",
  verification: "",
});
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ACCEPT = ".txt,.doc,.docx,.pdf";

// Extraction and the native chooser have longer bounded lifetimes than ordinary mutations.
export async function intakeRequest<T>(
  path: string,
  body?: unknown,
  timeoutMs = 45000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401)
      window.dispatchEvent(new Event("agent-desk:unauthorized"));
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        payload?.error?.message || `Request failed (${response.status}).`,
        response.status,
        payload?.error?.code || "request_failed",
      );
    if (!payload)
      throw new Error("The server returned an unreadable response.");
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "The operation timed out. Check its status before retrying; any unfinished draft will expire automatically.",
      );
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function uploadDocument(file: File): Promise<Attachment> {
  if (file.size > MAX_DOCUMENT_BYTES)
    throw new Error("This file exceeds the 10 MiB limit.");
  if (!/\.(txt|docx?|pdf)$/i.test(file.name))
    throw new Error("Choose a TXT, DOC, DOCX, or text-based PDF document.");
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("This file could not be read. Choose it again."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.readAsDataURL(file);
  });
  return intakeRequest<Attachment>("/attachments", {
    name: file.name,
    contentBase64,
  });
}

export async function downloadDocument(attachment: Attachment) {
  const response = await fetch(
    `/api/attachments/${encodeURIComponent(attachment.id)}/download`,
    { credentials: "same-origin" },
  );
  if (response.status === 401)
    window.dispatchEvent(new Event("agent-desk:unauthorized"));
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.error?.message ||
        "The original document could not be downloaded.",
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied)
      throw new Error(
        "Clipboard access is unavailable. Select and copy the packet below.",
      );
  }
}
