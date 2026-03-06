'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useMobileCenterHover } from '@/hooks/useMobileCenterHover';

export interface ServiceCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconColor?: 'primary' | 'accent' | 'muted';
  onClick?: () => void;
  className?: string;
}

export function ServiceCard({
  icon,
  title,
  description,
  iconColor = 'primary',
  onClick,
  className,
}: ServiceCardProps) {
  const { ref, isHovered } = useMobileCenterHover<HTMLDivElement>();
  const iconColors = {
    primary: 'text-primary',
    accent: 'text-accent',
    muted: 'text-muted-foreground',
  };

  return (
    <motion.div
      ref={ref}
      data-smart-hover={isHovered}
      onClick={onClick}
      whileHover="hover"
      animate={isHovered ? "hover" : "initial"}
      className={cn(
        'group flex flex-col',
        onClick && 'cursor-pointer',
        className
      )}
    >
      <motion.div
        variants={{
            hover: { y: -4, scale: 1.05 }
        }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={cn(
          'w-12 h-12 flex items-center mb-4 transition-colors duration-300',
          iconColors[iconColor],
          'group-hover:text-primary group-data-[smart-hover=true]:text-primary' // The requested color shift on hover
        )}
      >
        {icon}
      </motion.div>

      <h4 className="text-sm font-bold uppercase tracking-wide mb-2 group-hover:text-accent group-data-[smart-hover=true]:text-accent transition-colors">
        {title}
      </h4>

      <p className="text-sm leading-relaxed opacity-80">
        {description}
      </p>
    </motion.div>
  );
}

export default ServiceCard;
