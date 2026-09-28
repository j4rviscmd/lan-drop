import { useEffect, useRef, useState } from "react";

/**
 * Fires once when the element scrolls into view of the given scroll
 * container (root). Returns a ref for the watched element plus the flag.
 */
export function useInView<T extends Element>(rootRef: React.RefObject<Element | null>) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { root: rootRef.current },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootRef]);

  return { ref, inView };
}
