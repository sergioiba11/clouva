"use client";

import Link from "next/link";
import { PointerEvent, useRef, useState } from "react";

export type IgluMerchSlide = {
  id: string;
  name: string;
  image: string;
  href: string;
};

export function IgluMerchCarousel({
  products,
  className,
  itemClassName,
}: {
  products: IgluMerchSlide[];
  className?: string;
  itemClassName?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const gesture = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    dragged: false,
  });
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const DRAG_THRESHOLD = 8;

  if (!products.length) return null;

  function updateActive() {
    const node = scroller.current;
    if (!node || !node.clientWidth) return;
    setActive(Math.max(0, Math.min(products.length - 1, Math.round(node.scrollLeft / node.clientWidth))));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const node = scroller.current;
    if (!node) return;
    gesture.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: node.scrollLeft,
      dragged: false,
    };
    setDragging(false);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const node = scroller.current;
    const current = gesture.current;
    if (!node || !current.active || current.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    if (!current.dragged && Math.abs(deltaX) > DRAG_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
      current.dragged = true;
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (current.dragged) node.scrollLeft = current.startScrollLeft - deltaX;
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current.pointerId !== event.pointerId) return;
    gesture.current.active = false;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be released by the browser after a vertical pan.
    }
  }

  function cancelPointer(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current.pointerId !== event.pointerId) return;
    gesture.current.active = false;
    gesture.current.dragged = false;
    setDragging(false);
  }

  return (
    <div className={className} aria-label="Merch del IGLÚ">
      <div
        ref={scroller}
        onScroll={updateActive}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y pinch-zoom",
          overscrollBehaviorInline: "contain",
          cursor: dragging ? "grabbing" : "grab",
        }}
      >
        {products.map((product) => (
          <Link
            key={product.id}
            href={product.href}
            aria-label={product.name}
            className={itemClassName}
            onClick={(event) => {
              if (!gesture.current.dragged) return;
              event.preventDefault();
              gesture.current.dragged = false;
            }}
            style={{
              position: "relative",
              minWidth: "100%",
              height: "100%",
              scrollSnapAlign: "start",
              overflow: "hidden",
            }}
          >
            <img
              src={product.image}
              alt={product.name}
              loading="lazy"
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none", userSelect: "none" }}
            />
            <span
              style={{
                position: "absolute",
                left: 14,
                bottom: 12,
                maxWidth: "72%",
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1.2,
                textShadow: "0 1px 12px rgba(0,0,0,.95)",
                pointerEvents: "none",
              }}
            >
              {product.name}
            </span>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg,transparent 40%,rgba(0,8,15,.66) 100%)",
                pointerEvents: "none",
              }}
            />
          </Link>
        ))}
      </div>
      {products.length > 1 ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            zIndex: 4,
            right: 12,
            bottom: 10,
            display: "flex",
            gap: 4,
            pointerEvents: "none",
          }}
        >
          {products.map((product, index) => (
            <i
              key={product.id}
              style={{
                width: index === active ? 13 : 5,
                height: 5,
                borderRadius: 999,
                background: index === active ? "#dff7ff" : "rgba(223,247,255,.35)",
                transition: "width .2s ease",
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
