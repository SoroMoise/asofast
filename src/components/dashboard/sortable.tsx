"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** Poignée: attributs/listeners à étaler sur le bouton de drag. */
type Handle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners"> & {
  isDragging: boolean;
};

/**
 * Liste réordonnable (drag and drop) par-dessus @dnd-kit. `ids` doit être
 * l'ordre courant (clés stables); `onReorder` reçoit le nouvel ordre complet.
 * Pointeur (seuil 4px pour ne pas voler les clics) + clavier (flèches).
 */
export function SortableList({
  ids,
  onReorder,
  strategy = "grid",
  className,
  disabled,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  strategy?: "grid" | "horizontal";
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  // id stable (SSR = client) sinon @dnd-kit génère un aria-describedby différent
  // au render serveur et au render client -> mismatch d'hydratation.
  const dndId = React.useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={disabled ? undefined : handleDragEnd}
    >
      <SortableContext
        items={ids}
        strategy={
          strategy === "horizontal"
            ? horizontalListSortingStrategy
            : rectSortingStrategy
        }
        disabled={disabled}
      >
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/** Un élément réordonnable. `children` reçoit la poignée à câbler sur un bouton. */
export function SortableItem({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled?: boolean;
  className?: string;
  children: (handle: Handle) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}
