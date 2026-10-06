export class LocalResponseError extends Error {
  constructor(message: string, public readonly details: string) {
    super(message);
    this.name = "LocalResponseError";
  }
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new LocalResponseError(response.status === 413
      ? "The upload is too large for the local server."
      : "The local server couldn't read this upload. Restart the local app and try again.",
    `HTTP ${response.status}; expected a JSON response. No server response body or document contents are shown.`);
  }
  return response.json() as Promise<T>;
}
