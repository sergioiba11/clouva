"use client";

import Link from "next/link";
import { useRef, useState } from "react";

export type IgluMerchSlide = {
  id: string;
  name: string;
  image: string;
  href: string;
};

export function IgluMerchCarousel({
  products,
  className,
}: {
  products: IgluMerchSlide[];
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  if (!products.length) return null;

  function updateActive() {
    const node = scroller.current;
    if (!node || !node.clientWidth) return;
    setActive(Math.max(0, Math.min(products.length - 1, Math.round(node.scrollLeft / node.clientWidth))));
  }

  return (
    <div className={className} aria-label="Merch del IGLÚ">
      <div
        ref={scroller}
        onScroll={updateActive}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {products.map((product) => (
          <Link
            key={product.id}
            href={product.href}
            aria-label={product.name}
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
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
