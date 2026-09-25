import { useEffect, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Open modals, innermost last; only the innermost one answers Escape. */
const stack: symbol[] = [];

/** Centered dialog over a dimmed window; Escape and a backdrop click close it. */
export function Modal({ title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    const id = Symbol(title);
    stack.push(id);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || stack[stack.length - 1] !== id) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(id), 1);
    };
  }, [title, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="border-om-border bg-om-panel flex w-[460px] max-w-[calc(100vw-32px)] flex-col rounded-lg border shadow-2xl"
      >
        <header className="border-om-border border-b px-4 py-3 text-[13px] font-semibold">
          {title}
        </header>
        <div className="flex flex-col gap-3 px-4 py-4">{children}</div>
        {footer ? (
          <footer className="border-om-border flex items-center justify-end gap-2 border-t px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export const inputClass =
  "border-om-border bg-om-bg text-om-text placeholder:text-om-muted focus:border-om-amber h-8 w-full rounded-md border px-2.5 font-mono text-xs outline-none";
