"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ titleId, children, onClose, busy = false }: { titleId: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-lg border border-line bg-white p-5 shadow-xl backdrop:bg-black/40 sm:p-6">{children}</dialog>;
}
