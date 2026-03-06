'use client';

import React, { ReactNode, useId, useState, useEffect } from 'react';
import { useLenis } from 'lenis/react';
import { useMotionValue, useTransform, motion, useScroll, useVelocity, useSpring } from 'framer-motion';

interface ScopedKineticBlurProps {
  children: ReactNode;
  /**
   * If provided, motion blur will track the native scroll velocity of this container.
   * If omitted, it will track the global Lenis scroll velocity.
   */
  scrollRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  maxBlur?: number;
}

export function ScopedKineticBlur({ 
  children, 
  scrollRef, 
  className,
  maxBlur = 8
}: ScopedKineticBlurProps) {
  const filterId = useId().replace(/:/g, '-');
  const velocityY = useMotionValue(0);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Native scroll tracking for inner containers
  const { scrollY } = useScroll(scrollRef ? { container: scrollRef } : undefined);
  const scrollVelocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });

  // Global Lenis tracking for window scroll
  useLenis((lenis) => {
    if (!scrollRef) {
       velocityY.set(Math.abs(lenis.velocity));
    }
  });

  // Calculate blur based on the active tracking method
  // Native velocity can easily reach 1500px/s during fast swipes
  // Lenis velocity is typically between 0 and 60
  const nativeBlurY = useTransform(smoothVelocity, [-1500, 0, 1500], [maxBlur, 0, maxBlur]);
  const lenisBlurY = useTransform(velocityY, [0, 60], [0, maxBlur]);
  
  const activeBlurY = scrollRef ? nativeBlurY : lenisBlurY;
  const finalBlurY = useTransform(activeBlurY, (val) => isMobile ? 0 : val);

  return (
    <>
      <svg style={{ width: 0, height: 0, position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          <filter id={`scoped-kinetic-blur-${filterId}`}>
            <motion.feGaussianBlur 
              in="SourceGraphic" 
              stdDeviation={useTransform(finalBlurY, (val) => `0, ${val}`)}
            />
          </filter>
        </defs>
      </svg>
      <motion.div
        style={{ 
          filter: `url(#scoped-kinetic-blur-${filterId})`, 
          willChange: "filter, transform",
          transform: "translateZ(0)"
        }}
        className={className}
      >
        {children}
      </motion.div>
    </>
  );
}
