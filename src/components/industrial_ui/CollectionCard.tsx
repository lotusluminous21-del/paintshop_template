'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Verified } from 'lucide-react';
import { motion } from 'framer-motion';
import { useMobileCenterHover } from '@/hooks/useMobileCenterHover';

export interface CollectionCardProps {
  title: string;
  description: string;
  image: string;
  badge?: string;
  variant?: 'default' | 'featured';
  colors?: string[];
  onClick?: () => void;
  className?: string;
}

export function CollectionCard({
  title,
  description,
  image,
  badge,
  variant = 'default',
  colors = ['bg-primary', 'bg-muted-foreground', 'bg-muted'],
  onClick,
  className,
}: CollectionCardProps) {
  const { ref, isHovered } = useMobileCenterHover<HTMLDivElement>();

  return (
    <motion.div
      ref={ref}
      data-smart-hover={isHovered}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      animate={isHovered ? { scale: 1.02 } : { scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'group cursor-pointer flex flex-col h-full justify-start',
        className
      )}
    >
      <div className={cn(
        "w-full relative overflow-hidden bg-muted border border-border mb-4 ring-1 ring-border/10",
        variant === 'featured' ? 'aspect-[4/5]' : 'aspect-square'
      )}>
        <div
          className="absolute inset-0 w-full h-full bg-cover bg-center group-hover:scale-105 group-data-[smart-hover=true]:scale-105 transition-transform duration-500 grayscale group-hover:grayscale-0 group-data-[smart-hover=true]:grayscale-0"
          style={{ backgroundImage: `url(${image})` }}
        />
      </div>

      <h3 className="text-lg font-bold uppercase tracking-tight text-foreground">{title}</h3>
      <p className="text-muted-foreground text-sm mt-1">{description}</p>

      {badge ? (
        <div className="mt-4 flex gap-2 items-center">
          <Verified className="w-4 h-4 text-muted-foreground" />
          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">{badge}</span>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          {colors.map((color, i) => (
            <span key={i} className={cn("w-4 h-4 rounded-full border border-border/50", color)}></span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export default CollectionCard;
