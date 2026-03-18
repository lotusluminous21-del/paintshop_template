"use client"

import * as React from "react"
import { Product } from "@/lib/shopify/types"
import { ProductCard } from "@/components/industrial_ui/ProductCard"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
    ChevronRight,
    ChevronDown,
    ChevronUp,
    SlidersHorizontal,
    X,
    Layers,
} from "lucide-react"
import { IndexedFadeInUp, FadeInUp, StaggerContainer } from "@/components/ui/motion"
import { ScopedKineticBlur } from "@/components/effects/ScopedKineticBlur"

const SORT_OPTIONS = [
    { label: 'Προεπιλογή', value: 'default' },
    { label: 'Τιμή: Χαμηλή → Υψηλή', value: 'price-asc' },
    { label: 'Τιμή: Υψηλή → Χαμηλή', value: 'price-desc' },
    { label: 'Όνομα: Α–Ω', value: 'name-asc' },
    { label: 'Όνομα: Ω–Α', value: 'name-desc' },
]

// ─── Metafield + Tag Extraction Helpers ─────────────────────────

function getMetafieldValue(product: Product, key: string): string | null {
    const mf = product.metafields?.find(m => m !== null && m.key === key)
    return mf?.value ?? null
}

/**
 * Extract unique values for a given key across all products.
 * Tries metafields first, falls back to tags matching a prefix pattern.
 */
function extractFilterValues(
    products: Product[],
    metafieldKey: string,
    tagPrefix?: string,
): string[] {
    const values = new Set<string>()

    for (const product of products) {
        // Try metafield first
        const mfVal = getMetafieldValue(product, metafieldKey)
        if (mfVal) {
            try {
                const parsed = JSON.parse(mfVal)
                if (Array.isArray(parsed)) {
                    parsed.forEach((v: string) => values.add(v))
                } else {
                    values.add(mfVal)
                }
            } catch {
                values.add(mfVal)
            }
        }
    }

    // If metafields yielded nothing, try matching tags by prefix
    if (values.size === 0 && tagPrefix) {
        const prefix = tagPrefix.toLowerCase() + ':'
        for (const product of products) {
            for (const tag of product.tags || []) {
                const lower = tag.toLowerCase()
                if (lower.startsWith(prefix)) {
                    const val = tag.substring(prefix.length).trim()
                    if (val) values.add(val)
                }
            }
        }
    }

    return Array.from(values).sort()
}

/** Check if a product matches a filter value for a given metafield key / tag prefix */
function productMatchesFilter(
    product: Product,
    metafieldKey: string,
    selectedValues: Set<string>,
    tagPrefix?: string,
): boolean {
    if (selectedValues.size === 0) return true

    // Try metafield first
    const mfVal = getMetafieldValue(product, metafieldKey)
    if (mfVal) {
        try {
            const parsed = JSON.parse(mfVal)
            if (Array.isArray(parsed)) {
                return parsed.some((v: string) => selectedValues.has(v))
            }
        } catch { /* not JSON */ }
        return selectedValues.has(mfVal)
    }

    // Fallback: check tags
    if (tagPrefix) {
        const prefix = tagPrefix.toLowerCase() + ':'
        for (const tag of product.tags || []) {
            const lower = tag.toLowerCase()
            if (lower.startsWith(prefix)) {
                const val = tag.substring(prefix.length).trim()
                if (selectedValues.has(val)) return true
            }
        }
    }

    return false
}

// ─── Component ──────────────────────────────────────────────────

export function CategoriesClient({
    products,
    productTypes,
    activeType,
    initialCategory,
}: {
    products: Product[]
    productTypes: string[]
    activeType: string
    initialCategory?: string
}) {
    const router = useRouter()
    const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false)
    const [sortValue, setSortValue] = React.useState('default')
    const [sortDropdownOpen, setSortDropdownOpen] = React.useState(false)
    const sortRef = React.useRef<HTMLDivElement>(null)

    // Metafield-based filter state
    const [selectedFinishes, setSelectedFinishes] = React.useState<Set<string>>(new Set())
    const [selectedApplications, setSelectedApplications] = React.useState<Set<string>>(new Set())
    const [selectedEnvironments, setSelectedEnvironments] = React.useState<Set<string>>(new Set())
    const [selectedSurfaces, setSelectedSurfaces] = React.useState<Set<string>>(new Set())
    const [selectedBrands, setSelectedBrands] = React.useState<Set<string>>(new Set())
    const [selectedChemicalBases, setSelectedChemicalBases] = React.useState<Set<string>>(new Set())
    const [selectedProjectCategories, setSelectedProjectCategories] = React.useState<Set<string>>(
        new Set(initialCategory ? [initialCategory] : [])
    )

    // Price Filter State
    const allPrices = React.useMemo(() => products.map(p => parseFloat(p.priceRange.minVariantPrice.amount)), [products])
    const minGlobalPrice = allPrices.length > 0 ? Math.floor(Math.min(...allPrices)) : 0
    const maxGlobalPrice = allPrices.length > 0 ? Math.ceil(Math.max(...allPrices)) : 100
    const [maxPrice, setMaxPrice] = React.useState<number>(maxGlobalPrice)

    // Reset price filter if products radically change (optional, but good practice)
    React.useEffect(() => {
        setMaxPrice(maxGlobalPrice)
    }, [maxGlobalPrice])

    // Sync initialCategory from URL/props to state
    React.useEffect(() => {
        if (initialCategory) {
            setSelectedProjectCategories(new Set([initialCategory]))
        }
    }, [initialCategory])

    // Extract available filter values from products (metafield → tag fallback)
    const availableFinishes = React.useMemo(
        () => extractFilterValues(products, 'finish', 'finish'), [products]
    )
    const availableApplications = React.useMemo(
        () => extractFilterValues(products, 'application_method', 'application'), [products]
    )
    const availableEnvironments = React.useMemo(
        () => extractFilterValues(products, 'environment', 'environment'), [products]
    )
    const availableSurfaces = React.useMemo(
        () => extractFilterValues(products, 'surfaces', 'surface'), [products]
    )
    const availableChemicalBases = React.useMemo(
        () => extractFilterValues(products, 'chemical_base', 'chemical-base'), [products]
    )
    const availableProjectCategories = React.useMemo(
        () => extractFilterValues(products, 'category', 'category'), [products]
    )
    const availableBrands = React.useMemo(() => {
        const brands = new Set<string>()
        products.forEach(p => p.vendor && brands.add(p.vendor))
        return Array.from(brands)
    }, [products])

    // Navigation
    const handleTypeClick = (type: string) => {
        setSelectedFinishes(new Set())
        setSelectedApplications(new Set())
        setSelectedEnvironments(new Set())
        setSelectedSurfaces(new Set())
        setSelectedBrands(new Set())
        setSelectedChemicalBases(new Set())
        setSelectedProjectCategories(new Set())
        setMaxPrice(maxGlobalPrice)
        router.push(`/categories${type === 'all' ? '' : `?type=${encodeURIComponent(type)}`}`, { scroll: false })
    }

    // Close sort dropdown on outside click
    React.useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
                setSortDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    // Toggle helper
    const toggleFilter = (
        set: Set<string>,
        setter: React.Dispatch<React.SetStateAction<Set<string>>>,
        value: string
    ) => {
        const next = new Set(set)
        if (next.has(value)) next.delete(value)
        else next.add(value)
        setter(next)
    }

    const clearAllFilters = () => {
        setSelectedFinishes(new Set())
        setSelectedApplications(new Set())
        setSelectedEnvironments(new Set())
        setSelectedSurfaces(new Set())
        setSelectedBrands(new Set())
        setSelectedChemicalBases(new Set())
        setSelectedProjectCategories(new Set())
        setMaxPrice(maxGlobalPrice)
    }

    // Filter + sort products
    const filteredProducts = React.useMemo(() => {
        let result = [...products]

        // 1. Filter by productType
        if (activeType !== 'all') {
            result = result.filter(p => p.productType === activeType)
        }

        // 2. Metafield / tag / vendor filters
        result = result.filter(p => productMatchesFilter(p, 'finish', selectedFinishes, 'finish'))
        result = result.filter(p => productMatchesFilter(p, 'application_method', selectedApplications, 'application'))
        result = result.filter(p => productMatchesFilter(p, 'environment', selectedEnvironments, 'environment'))
        result = result.filter(p => productMatchesFilter(p, 'surfaces', selectedSurfaces, 'surface'))
        result = result.filter(p => productMatchesFilter(p, 'chemical_base', selectedChemicalBases, 'chemical-base'))
        result = result.filter(p => productMatchesFilter(p, 'category', selectedProjectCategories, 'category'))
        if (selectedBrands.size > 0) {
            result = result.filter(p => p.vendor && selectedBrands.has(p.vendor))
        }

        // 2.5 Filter by Price
        result = result.filter(p => {
            const price = parseFloat(p.priceRange.minVariantPrice.amount)
            return price <= maxPrice
        })

        // 3. Sort
        switch (sortValue) {
            case 'price-asc':
                result.sort((a, b) =>
                    parseFloat(a.priceRange.minVariantPrice.amount) - parseFloat(b.priceRange.minVariantPrice.amount)
                )
                break
            case 'price-desc':
                result.sort((a, b) =>
                    parseFloat(b.priceRange.minVariantPrice.amount) - parseFloat(a.priceRange.minVariantPrice.amount)
                )
                break
            case 'name-asc':
                result.sort((a, b) => a.title.localeCompare(b.title))
                break
            case 'name-desc':
                result.sort((a, b) => b.title.localeCompare(a.title))
                break
        }

        return result
    }, [products, activeType, selectedFinishes, selectedApplications, selectedEnvironments, selectedSurfaces, selectedBrands, selectedChemicalBases, selectedProjectCategories, maxPrice, sortValue])

    // Active type label
    const categoryTitle = activeType === 'all' ? 'Όλα τα Προϊόντα' : activeType
    const titleWords = categoryTitle.split(' ')
    const firstLine = titleWords.slice(0, Math.ceil(titleWords.length / 2)).join(' ')
    const secondLine = titleWords.slice(Math.ceil(titleWords.length / 2)).join(' ')

    // Active filter count for badge
    const isPriceFiltered = maxPrice < maxGlobalPrice
    const activeFilterCount = selectedFinishes.size + selectedApplications.size + selectedEnvironments.size + selectedSurfaces.size + selectedBrands.size + selectedChemicalBases.size + selectedProjectCategories.size + (isPriceFiltered ? 1 : 0)

    // Whether we have any filter options to display
    const hasAnyFilters = availableFinishes.length > 0 || availableApplications.length > 0 || availableEnvironments.length > 0 || availableSurfaces.length > 0 || availableBrands.length > 0 || availableChemicalBases.length > 0 || availableProjectCategories.length > 0 || maxGlobalPrice > minGlobalPrice

    // ─── Filter toggle group renderer ───
    const FilterSection = ({
        title,
        options,
        selected,
        setter,
        defaultOpen = false,
    }: {
        title: string;
        options: string[];
        selected: Set<string>;
        setter: React.Dispatch<React.SetStateAction<Set<string>>>;
        defaultOpen?: boolean;
    }) => {
        const [isOpen, setIsOpen] = React.useState(defaultOpen || selected.size > 0);

        if (options.length === 0) return null;

        return (
            <div className="mb-2 border-b border-border/50 pb-4">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex justify-between items-center w-full group py-2"
                >
                    <div className="flex items-center gap-2">
                        <h4 className="text-xs font-black text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                            {title}
                        </h4>
                        {selected.size > 0 && (
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shadow-sm">
                                {selected.size}
                            </span>
                        )}
                    </div>
                    {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    )}
                </button>

                {isOpen && (
                    <div className="flex flex-wrap gap-2 mt-4 animate-in fade-in slide-in-from-top-1 duration-200">
                        {options.map(option => (
                            <button
                                key={option}
                                onClick={() => toggleFilter(selected, setter, option)}
                                className={cn(
                                    'px-3 py-1.5 text-xs font-medium rounded-none border transition-colors',
                                    selected.has(option)
                                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                        : 'bg-background text-foreground border-border hover:border-foreground/30'
                                )}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // Sidebar content (shared desktop + mobile)
    const sidebarContent = (
        <div>
            {/* Product Type Categories */}
            <div className="mb-8">
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wide mb-4">
                    Κατηγορίες
                </h3>
                <div className="space-y-1">
                    <button
                        onClick={() => handleTypeClick('all')}
                        className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-none transition-colors text-left',
                            activeType === 'all'
                                ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
                                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                        )}
                    >
                        <Layers className="w-4 h-4 flex-shrink-0" />
                        <span className="flex-1">Όλα τα Προϊόντα</span>
                    </button>
                    {productTypes.map((type) => (
                        <button
                            key={type}
                            onClick={() => handleTypeClick(type)}
                            className={cn(
                                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-none transition-colors text-left',
                                activeType === type
                                    ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                            )}
                        >
                            <span className="flex-1">{type}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Dynamic Filters */}
            {hasAnyFilters && (
                <div className="border-t border-border pt-6">
                    {/* Price Slider */}
                    {maxGlobalPrice > minGlobalPrice && (
                        <div className="mb-6">
                            <div className="flex justify-between items-center mb-4">
                                <h4 className="text-xs font-black text-muted-foreground uppercase tracking-wide">
                                    Μέγιστη Τιμή
                                </h4>
                                <span className="text-xs font-bold font-mono bg-secondary px-2 py-0.5 rounded">
                                    €{maxPrice}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={minGlobalPrice}
                                max={maxGlobalPrice}
                                value={maxPrice}
                                onChange={(e) => setMaxPrice(Number(e.target.value))}
                                className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                                style={{
                                    /* Additional custom track styling if needed */
                                    background: `linear-gradient(to right, hsl(var(--primary)) ${(maxPrice - minGlobalPrice) / (maxGlobalPrice - minGlobalPrice) * 100}%, hsl(var(--secondary)) ${(maxPrice - minGlobalPrice) / (maxGlobalPrice - minGlobalPrice) * 100}%)`
                                }}
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground mt-3 uppercase tracking-widest font-semibold">
                                <span>€{minGlobalPrice}</span>
                                <span>€{maxGlobalPrice}</span>
                            </div>
                        </div>
                    )}

                    <FilterSection title="Κατηγορία Έργου" options={availableProjectCategories} selected={selectedProjectCategories} setter={setSelectedProjectCategories} defaultOpen={true} />
                    <FilterSection title="Μάρκα" options={availableBrands} selected={selectedBrands} setter={setSelectedBrands} />
                    <FilterSection title="Χημική Βάση" options={availableChemicalBases} selected={selectedChemicalBases} setter={setSelectedChemicalBases} />
                    <FilterSection title="Φινίρισμα" options={availableFinishes} selected={selectedFinishes} setter={setSelectedFinishes} />
                    <FilterSection title="Εφαρμογή" options={availableApplications} selected={selectedApplications} setter={setSelectedApplications} />
                    <FilterSection title="Περιβάλλον" options={availableEnvironments} selected={selectedEnvironments} setter={setSelectedEnvironments} />
                    <FilterSection title="Επιφάνειες" options={availableSurfaces} selected={selectedSurfaces} setter={setSelectedSurfaces} />
                </div>
            )}

            {/* Clear Filters */}
            {activeFilterCount > 0 && (
                <button
                    onClick={clearAllFilters}
                    className="text-xs font-bold text-accent hover:text-primary uppercase tracking-wider transition-colors mt-2"
                >
                    Καθαρισμός Φίλτρων ({activeFilterCount})
                </button>
            )}
        </div>
    )

    return (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 pt-8 md:pt-12 pb-16 md:pb-24">
            {/* Breadcrumbs */}
            <nav className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-6 md:mb-8">
                <Link href="/" className="hover:text-accent transition-colors">
                    Κατάστημα
                </Link>
                <ChevronRight className="w-3 h-3" />
                <span className="text-foreground">{categoryTitle}</span>
            </nav>

            <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
                {/* Desktop Sidebar */}
                <aside className="hidden lg:block w-64 shrink-0 relative">
                    <div data-lenis-prevent="true" className="sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto overscroll-contain pb-8 pr-4"
                         style={{ 
                             scrollbarWidth: 'thin', 
                             scrollbarColor: 'hsl(var(--muted-foreground)) transparent'
                         }}>
                        <FadeInUp delay={0.2}>
                            {sidebarContent}
                        </FadeInUp>
                    </div>
                </aside>

                {/* Mobile Filter Toggle */}
                <div className="lg:hidden">
                    <button
                        onClick={() => setMobileFiltersOpen(true)}
                        className="flex items-center gap-2 px-4 py-2.5 border border-border text-sm font-bold uppercase tracking-wider hover:bg-secondary transition-colors rounded-none"
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                        Φίλτρα
                        {activeFilterCount > 0 && (
                            <span className="ml-1 w-5 h-5 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>
                </div>

                {/* Mobile Filters Drawer */}
                {mobileFiltersOpen && (
                    <div className="fixed inset-0 z-50 lg:hidden">
                        <div
                            className="absolute inset-0 bg-black/50"
                            onClick={() => setMobileFiltersOpen(false)}
                        />
                        <div data-lenis-prevent="true" className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-background border-r border-border p-6 overflow-y-auto">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-sm font-bold uppercase tracking-widest">Φίλτρα</h3>
                                <button
                                    onClick={() => setMobileFiltersOpen(false)}
                                    className="p-1 hover:bg-secondary rounded"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            {sidebarContent}
                        </div>
                    </div>
                )}

                {/* Content Area */}
                <section className="flex-1 min-w-0">
                    {/* Hero Heading */}
                    <div className="mb-8 md:mb-12">
                        <IndexedFadeInUp index={0}>
                            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black uppercase tracking-tighter leading-[0.9] mb-4">
                                {secondLine ? (
                                    <>
                                        {firstLine}<br />
                                        <span className="text-accent">{secondLine}</span>
                                    </>
                                ) : (
                                    <span>{categoryTitle}</span>
                                )}
                            </h1>
                        </IndexedFadeInUp>
                        <IndexedFadeInUp index={1}>
                            <p className="text-sm font-medium text-muted-foreground max-w-xl uppercase tracking-wider">
                                {activeType === 'all'
                                    ? 'Περιηγηθείτε στην πλήρη γκάμα των επαγγελματικών προϊόντων μας.'
                                    : `Επαγγελματικά ${activeType.toLowerCase()} σχεδιασμένα για ακραία αντοχή και απόδοση.`
                                }
                            </p>
                        </IndexedFadeInUp>
                    </div>

                    {/* Toolbar */}
                    <div className="flex items-center justify-between border-y border-border py-3 md:py-4 mb-6 md:mb-8">
                        <p className="text-[10px] font-bold tracking-widest uppercase">
                            Εμφάνιση {filteredProducts.length} από {products.length} {filteredProducts.length === 1 ? 'Αποτέλεσμα' : 'Αποτελέσματα'}
                        </p>
                        <div className="relative" ref={sortRef}>
                            <button
                                onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest hover:text-accent transition-colors"
                            >
                                Ταξινόμηση: {SORT_OPTIONS.find(o => o.value === sortValue)?.label}
                                <ChevronRight className={cn(
                                    "w-3 h-3 transition-transform",
                                    sortDropdownOpen ? "rotate-90" : "rotate-0"
                                )} />
                            </button>
                            {sortDropdownOpen && (
                                <div className="absolute right-0 top-full mt-2 w-48 bg-background border border-border shadow-lg z-30 py-1">
                                    {SORT_OPTIONS.map(option => (
                                        <button
                                            key={option.value}
                                            onClick={() => {
                                                setSortValue(option.value)
                                                setSortDropdownOpen(false)
                                            }}
                                            className={cn(
                                                "w-full text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors",
                                                sortValue === option.value
                                                    ? "text-accent bg-secondary"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                                            )}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Product Grid */}
                    <ScopedKineticBlur className="w-full">
                        {filteredProducts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <p className="text-lg font-bold text-foreground uppercase tracking-tight">Δεν Βρέθηκαν Προϊόντα</p>
                                <p className="text-sm text-muted-foreground mt-2">
                                    {activeFilterCount > 0
                                        ? 'Δοκιμάστε να προσαρμόσετε ή να καθαρίσετε τα φίλτρα σας.'
                                        : 'Δοκιμάστε μια διαφορετική κατηγορία.'}
                                </p>
                                {activeFilterCount > 0 && (
                                    <button
                                        onClick={clearAllFilters}
                                        className="mt-4 px-6 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors"
                                    >
                                        Καθαρισμός Φίλτρων
                                    </button>
                                )}
                            </div>
                        ) : (
                            <StaggerContainer key={filteredProducts.map(p => p.id).join(',')} staggerDelay={0.15} viewportAmount="some" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                                {filteredProducts.map((product) => {
                                    const price = parseFloat(product.priceRange.minVariantPrice.amount)
                                    const imageUrl = product.featuredImage?.url || ''

                                    return (
                                        <FadeInUp inStaggerGroup key={product.id} className="h-full">
                                            <Link href={`/products/${product.handle}`} className="outline-none block h-full">
                                                <ProductCard
                                                    id={product.id}
                                                    title={product.title}
                                                    category={product.productType || 'Γενικά'}
                                                    categoryColor={product.productType ? 'primary' : 'muted'}
                                                    price={price}
                                                    priceUnit={product.variants?.edges?.[0]?.node?.title !== 'Default Title'
                                                        ? product.variants?.edges?.[0]?.node?.title
                                                        : ''
                                                    }
                                                    image={imageUrl}
                                                    badge={product.tags?.includes('new') ? 'New Arrival' : undefined}
                                                    badgeVariant="new"
                                                    inStock={product.variants?.edges?.[0]?.node?.availableForSale ?? true}
                                                    className="h-full"
                                                />
                                            </Link>
                                        </FadeInUp>
                                    )
                                })}
                            </StaggerContainer>
                        )}
                    </ScopedKineticBlur>

                </section>
            </div>
        </div>
    )
}
