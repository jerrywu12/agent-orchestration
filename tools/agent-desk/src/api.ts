export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  const requestBody =
    body === undefined &&
    ["POST", "PATCH", "PUT"].includes(method.toUpperCase())
      ? {}
      : body;
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      signal: controller.signal,
      headers:
        requestBody === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      ...(requestBody === undefined
        ? {}
        : { body: JSON.stringify(requestBody) }),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError(
        "The server returned an unreadable response. Try refreshing.",
        response.status,
        "invalid_response",
      );
    }
    if (!response.ok) {
      if (response.status === 401 && path !== "/login")
        window.dispatchEvent(new Event("agent-desk:unauthorized"));
      throw new ApiError(
        payload.error?.message || `Request failed (${response.status}).`,
        response.status,
        payload.error?.code || "request_failed",
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "The server took too long to respond. Your changes may have reached it; refresh before retrying.",
      );
    throw new Error(
      "Unable to reach Agent Desk. Check the connection and try again.",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export const pathId = (id: string) => encodeURIComponent(id);
