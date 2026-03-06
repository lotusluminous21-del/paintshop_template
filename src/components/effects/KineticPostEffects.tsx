'use client';

import { ReactNode, useState, useEffect } from 'react';
import { useLenis } from 'lenis/react';
import { useMotionValue, useTransform, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';

export function KineticPostEffects({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  
  // Disable kinetic scroll effects on pages with complex inner scroll areas
  // to avoid scroll fighting and jarring full-page blur artifacts.
  const pathnameIsDisabled = pathname?.startsWith('/categories') || pathname?.startsWith('/expert');
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const isKineticDisabled = pathnameIsDisabled || isMobile;

  // We'll track the current scroll velocity via a motion value to smoothly map it to a blur amount
  const velocityY = useMotionValue(0);

  // Hook into Lenis frame updates
  useLenis((lenis) => {
    // lenis.velocity is the current scroll velocity
    // We update our motion value with it
    velocityY.set(Math.abs(lenis.velocity));
  });

  // Map the absolute velocity to a blur value (stdDeviation on Y axis)
  // Experiment with the input range (0 to 50 is a typical fast scroll velocity)
  // and the output range (0 to 15 pixels of blur).
  const blurY = useTransform(velocityY, [0, 60], [0, 8]);
  const blurYString = useTransform(blurY, (val) => `0, ${val}`);

  if (isKineticDisabled) {
    return <>{children}</>;
  }

  return (
    <>
      <svg
        style={{ width: 0, height: 0, position: 'absolute', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <defs>
          <filter id="kinetic-motion-blur">
            {/* 
              feGaussianBlur stdDeviation can take two values: x and y.
              We keep x at 0 and map y to our motion-blur value.
            */}
            <motion.feGaussianBlur 
              in="SourceGraphic" 
              // We typecast as any because framer-motion might complain about SVG props
              stdDeviation={blurYString as any}
            />
          </filter>
        </defs>
      </svg>

      {/* 
        Wrap the content in a container that applies the filter.
        will-change: filter is crucial for performance.
      */}
      <motion.div
        style={{
          filter: "url(#kinetic-motion-blur)",
          willChange: "filter, transform",
          transform: "translateZ(0)",
        }}
        className="w-full relative min-h-screen z-0"
      >
        {children}
      </motion.div>
    </>
  );
}
