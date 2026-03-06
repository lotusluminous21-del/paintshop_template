import { useState, useEffect, useRef } from 'react';

export function useMobileCenterHover<T extends HTMLElement = HTMLDivElement>() {
  const [isHovered, setIsHovered] = useState(false);
  const ref = useRef<T>(null);

  useEffect(() => {
    // Only apply on touch/mobile devices under a certain width.
    if (typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches) {
      return;
    }

    const currentRef = ref.current;
    if (!currentRef) return;

    // Use IntersectionObserver to detect when the element is near the vertical center
    // We use rootMargin to shrink the viewport bounding box to the middle 30% vertically.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsHovered(entry.isIntersecting);
        });
      },
      {
        root: null,
        // Trigger when any part of the requested element enters the middle 40% of the screen.
        // -30% top and -30% bottom means the active area is the middle 40%.
        rootMargin: '-30% 0px -30% 0px',
        threshold: 0.5, 
      }
    );

    observer.observe(currentRef);

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
      observer.disconnect();
    };
  }, []);

  return { ref, isHovered };
}
