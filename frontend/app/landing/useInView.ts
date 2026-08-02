'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

export function useInView<T extends HTMLElement>(): {
  ref: RefObject<T>;
  inView: boolean;
} {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, inView };
}
