"use client";

export const dataChangedEvent = "payslip-data-changed";
export const gmailCollapsedKey = "payslip-gmail-import-collapsed";
const channelName = "payslip-local-data";
export function notifyDataChanged(cleared = false) {
  window.dispatchEvent(new CustomEvent(dataChangedEvent, { detail: { cleared } }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ cleared });
    channel.close();
  }
}
export function listenDataChanged(callback: (cleared: boolean) => void) {
  const handler = (event: Event) => callback(event instanceof CustomEvent && event.detail?.cleared === true);
  window.addEventListener(dataChangedEvent, handler);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName) : null;
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => callback(Boolean(event.data && typeof event.data === "object" && "cleared" in event.data && event.data.cleared === true));
  return () => { window.removeEventListener(dataChangedEvent, handler); channel?.close(); };
}
export function clearClientData() {
  try {
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith("payslip-")) storage.removeItem(key);
    }
  }
  } finally { notifyDataChanged(true); }
}
