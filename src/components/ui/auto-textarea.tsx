import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Textarea qui grandit avec son contenu: pas de scroll interne, pas de poignée
 * de resize. La hauteur suit le nombre de lignes (édition, reset, changement de
 * valeur piloté par le parent). Même look qu'un Input sur une ligne (min-h-10).
 */
export const AutoTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, value, onChange, ...props }, ref) => {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    },
    [ref]
  );

  const resize = React.useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    // "auto" d'abord: laisse le textarea rétrécir quand on supprime des lignes,
    // sinon scrollHeight resterait bloqué sur la hauteur maximale atteinte.
    el.style.height = "auto";
    // scrollHeight = contenu + padding, SANS la bordure. En box-sizing:border-box
    // (défaut Tailwind) la hauteur CSS inclut la bordure: on l'ajoute pour ne pas
    // rogner la dernière ligne d'1-2px (sinon overflow caché sur le bas).
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, []);

  // Réajuste à chaque changement de valeur, y compris quand le parent la reset
  // (changement de langue, sauvegarde) sans passer par onChange.
  React.useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      ref={setRefs}
      value={value}
      rows={1}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      className={cn(
        "flex min-h-10 w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm leading-normal ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
AutoTextarea.displayName = "AutoTextarea";
