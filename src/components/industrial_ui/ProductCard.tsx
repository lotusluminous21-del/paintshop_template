import React from 'react';
import { cn } from '@/lib/utils';
import { useMobileCenterHover } from '@/hooks/useMobileCenterHover';

export interface ProductCardProps {
  id: string;
  title: string;
  category: string;
  categoryColor?: 'primary' | 'accent' | 'muted';
  price: number;
  priceUnit?: string;
  image: string;
  badge?: string;
  badgeVariant?: 'new' | 'sale' | 'featured';
  inStock?: boolean;
  onClick?: () => void;
  onAddToCart?: () => void;
  className?: string;
}

export function ProductCard({
  id,
  title,
  category,
  categoryColor = 'primary',
  price,
  priceUnit = '',
  image,
  badge,
  badgeVariant = 'new',
  inStock = true,
  onClick,
  onAddToCart,
  className,
}: ProductCardProps) {
  const { ref, isHovered } = useMobileCenterHover<HTMLDivElement>();
  const categoryColors = {
    primary: 'text-primary',
    accent: 'text-accent',
    muted: 'text-muted-foreground',
  };

  const badgeStyles = {
    new: 'bg-accent text-accent-foreground',
    sale: 'bg-destructive text-destructive-foreground',
    featured: 'bg-primary text-primary-foreground',
  };

  return (
    <div
      ref={ref}
      data-smart-hover={isHovered}
      className={cn(
        'group relative bg-card border border-border rounded-lg overflow-hidden',
        'transition-all duration-200 ease-out',
        'hover:shadow-card-hover hover:-translate-y-0.5',
        'data-[smart-hover=true]:shadow-card-hover data-[smart-hover=true]:-translate-y-0.5',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {/* Image Container */}
      <div className="relative aspect-square bg-secondary overflow-hidden">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 group-data-[smart-hover=true]:scale-105"
        />
        
        {/* Badge */}
        {badge && (
          <span
            className={cn(
              'absolute top-3 left-3 px-3 py-1',
              'text-[10px] font-semibold uppercase tracking-wide',
              'rounded-sm',
              badgeStyles[badgeVariant]
            )}
          >
            {badge}
          </span>
        )}

        {/* Quick Add Button */}
        {onAddToCart && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddToCart();
            }}
            className={cn(
              'absolute bottom-3 right-3 p-2',
              'bg-primary text-primary-foreground rounded-md',
              'opacity-0 translate-y-2 transition-all duration-200',
              'group-hover:opacity-100 group-hover:translate-y-0',
              'group-data-[smart-hover=true]:opacity-100 group-data-[smart-hover=true]:translate-y-0',
              'hover:bg-primary-light',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
            )}
            aria-label="Add to cart"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Category */}
        <span
          className={cn(
            'text-[11px] font-semibold uppercase tracking-widest',
            categoryColors[categoryColor]
          )}
        >
          {category}
        </span>

        {/* Title */}
        <h3 className="mt-1 text-base font-semibold text-foreground line-clamp-2">
          {title}
        </h3>

        {/* Price & Stock */}
        <div className="mt-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-foreground">
              ${price.toFixed(2)}
            </span>
            {priceUnit && (
              <span className="text-sm text-muted-foreground">
                / {priceUnit}
              </span>
            )}
          </div>
          
          {!inStock && (
            <span className="text-xs font-medium text-destructive">
              Out of Stock
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductCard;
