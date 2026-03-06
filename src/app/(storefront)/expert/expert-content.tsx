'use client';

/**
 * ExpertContent — AI Expert Assistant Screen (Industrial Design System)
 *
 * Layout: sidebar (desktop) + chat area + sticky bottom input
 * Mobile: sidebar collapses to a Sheet drawer
 *
 * Reuses: ChatMessage, ProjectProgress, TechLogs, QuickActionButton
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import {
    RotateCcw,
    Paperclip,
    Send,
    Zap,
    PanelLeftOpen,
    Bot,
    ChevronRight,
    CheckCircle2,
    Package,
    Loader2,
    X,
    ImageIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { IndexedFadeInUp, FadeInUp } from '@/components/ui/motion';

import { useExpertStore, type ChatMessage as StoreChatMessage, type SidebarState } from '@/lib/expert/store';
import { useProductDetails } from '@/lib/expert/use-product-details';
import { ChatMessage } from '@/components/industrial_ui/ChatMessage';
import { ProjectProgress, type ProgressStep } from '@/components/industrial_ui/ProjectProgress';
import { QuickActionButton } from '@/components/industrial_ui/QuickActionButton';
import { ProductLightbox } from '@/components/industrial_ui/ProductLightbox';
import {
    Sheet,
    SheetContent,
    SheetTrigger,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { validateImageFile, resizeImageToBase64, uploadImageToStorage } from '@/lib/expert/image-utils';

// ─── Status derivation ──────────────────────────────────────────

type ConversationStatus = 'idle' | 'thinking' | 'chat' | 'complete';

function deriveStatus(
    hasMessages: boolean,
    isTyping: boolean,
    solution: any,
): ConversationStatus {
    if (!hasMessages) return 'idle';
    if (isTyping) return 'thinking';
    if (solution) return 'complete';
    return 'chat';
}

const formatPrice = (price: number) =>
    new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(price);

// Visual steps: 4 phases (solution_ready maps to 'complete' badge visually)
const VISUAL_PHASE_ORDER: Array<SidebarState['overallPhase']> = [
    'initialization',
    'gathering_info',
    'product_matching',
    'complete',
];

const OVERALL_PHASE_LABELS: Record<string, string> = {
    initialization: 'Αρχικοποίηση',
    gathering_info: 'Συλλογή Πληροφοριών',
    product_matching: 'Αντιστοίχιση Προϊόντων',
    solution_ready: 'Ολοκλήρωση',
    complete: 'Ολοκλήρωση',
};

function deriveProgressFromSidebar(
    sidebarState: SidebarState | null,
    isTyping: boolean,
    solution: any,
): { steps: ProgressStep[]; progress: number } {
    const currentPhase = sidebarState?.overallPhase || 'initialization';
    // Map solution_ready to the last visual slot
    const visualPhase = currentPhase === 'solution_ready' ? 'complete' : currentPhase;
    const currentIdx = VISUAL_PHASE_ORDER.indexOf(visualPhase as SidebarState['overallPhase']);

    const steps: ProgressStep[] = VISUAL_PHASE_ORDER.map((phase, idx) => {
        const label = sidebarState?.overallPhaseLabel && phase === visualPhase
            ? sidebarState.overallPhaseLabel
            : OVERALL_PHASE_LABELS[phase];

        let status: ProgressStep['status'];
        if (idx < currentIdx) status = 'completed';
        else if (idx === currentIdx) status = isTyping ? 'current' : (solution ? 'completed' : 'current');
        else status = 'pending';

        return { id: String(idx + 1), label, status };
    });

    const completed = steps.filter(s => s.status === 'completed').length;
    const progress = Math.round((completed / steps.length) * 100);

    return { steps, progress };
}

// ─── Sidebar Content (shared by desktop + mobile drawer) ────────

interface SidebarProps {
    steps: ProgressStep[];
    progress: number;
    sidebarState: SidebarState | null;
    sidebarRefreshing: boolean;
}

function SidebarContent({ steps, progress, sidebarState, sidebarRefreshing }: SidebarProps) {
    const [lightboxHandle, setLightboxHandle] = useState<string | null>(null);

    // Deduplicate products by handle to prevent React duplicate key warnings
    const uniqueProducts = useMemo(() => {
        if (!sidebarState?.recommendedProducts) return [];
        const seen = new Set<string>();
        return sidebarState.recommendedProducts.filter(p => {
            const key = p.handle;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [sidebarState?.recommendedProducts]);

    // Extract handles for Shopify product enrichment
    const productHandles = useMemo(() => uniqueProducts.map(p => p.handle), [uniqueProducts]);
    const { products, loading } = useProductDetails(productHandles);

    const lightboxProduct = lightboxHandle ? products.get(lightboxHandle) ?? null : null;
    const lightboxMeta = sidebarState?.recommendedProducts?.find(p => p.handle === lightboxHandle);

    const dimensions = sidebarState?.knowledgeDimensions || [];
    const hasDimensions = dimensions.length > 0;

    return (
        <div className="flex flex-col gap-6 h-full">
            {/* Project Progress */}
            <ProjectProgress
                title="Πρόοδος Ανάλυσης"
                progress={progress}
                steps={steps}
            />

            {/* Knowledge Dimensions — domain-specific checklist */}
            {hasDimensions && (
                <>
                    <div className="h-px bg-border" />
                    <div className="space-y-2">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                            Ανάλυση Έργου
                            {sidebarState?.domain && (
                                <span className="ml-1.5 normal-case font-medium text-accent">
                                    — {sidebarState.domain}
                                </span>
                            )}
                        </h3>
                        <div className="space-y-1">
                            {dimensions.map((dim) => (
                                <div key={dim.id} className="flex items-center gap-2 text-xs">
                                    {/* Status indicator */}
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dim.status === 'identified' ? 'bg-green-500' :
                                        dim.status === 'pending' ? 'bg-amber-400 animate-pulse' :
                                            'bg-muted-foreground/30'
                                        }`} />
                                    {/* Label */}
                                    <span className="text-muted-foreground font-medium truncate">
                                        {dim.label}
                                    </span>
                                    {/* Value badge */}
                                    {dim.value && dim.status === 'identified' && (
                                        <span className="ml-auto px-1.5 py-0 rounded text-[10px] font-semibold bg-accent/10 text-accent border border-accent/20 flex-shrink-0 max-w-[120px] truncate">
                                            {dim.value}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Recommended Products */}
            <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    Προτεινόμενα
                    {loading && <Loader2 className="w-3 h-3 animate-spin text-accent ml-auto" />}
                </h3>

                {uniqueProducts.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                        {uniqueProducts.map((rec) => {
                            const shopifyProduct = products.get(rec.handle);
                            const image = shopifyProduct?.featuredImage;
                            const price = shopifyProduct?.priceRange?.minVariantPrice;

                            return (
                                <button
                                    key={rec.handle}
                                    onClick={() => setLightboxHandle(rec.handle)}
                                    className="flex flex-col rounded-lg bg-secondary border border-border hover:border-accent/50 hover:bg-secondary/70 transition-all text-left group cursor-pointer overflow-hidden"
                                >
                                    {/* Square image area */}
                                    <div className="relative w-full aspect-square bg-muted border-b border-border overflow-hidden">
                                        {image?.url ? (
                                            <Image
                                                src={image.url}
                                                alt={image.altText || rec.title}
                                                fill
                                                className="object-contain p-2 group-hover:scale-105 transition-transform duration-200"
                                                sizes="120px"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Package className="w-6 h-6 text-muted-foreground/30" />
                                            </div>
                                        )}
                                    </div>
                                    {/* Info strip */}
                                    <div className="p-1.5 flex flex-col gap-0.5">
                                        <p className="text-[11px] font-bold text-foreground line-clamp-2 leading-tight group-hover:text-accent transition-colors">
                                            {rec.title}
                                        </p>
                                        <div className="flex items-center justify-between gap-1 mt-0.5">
                                            {rec.sequence_step && (
                                                <span className="px-1 py-0 rounded text-[9px] font-semibold bg-accent/10 text-accent truncate">
                                                    {rec.sequence_step}
                                                </span>
                                            )}
                                            {price && (
                                                <span className="text-[10px] font-semibold text-muted-foreground flex-shrink-0">
                                                    {parseFloat(price.amount).toLocaleString('el-GR', { style: 'currency', currency: price.currencyCode || 'EUR' })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground/60 italic">Αναμονή ανάλυσης...</p>
                )}
            </div>

            {/* Product Lightbox */}
            <ProductLightbox
                product={lightboxProduct}
                open={!!lightboxHandle}
                onOpenChange={(open) => !open && setLightboxHandle(null)}
                sequenceStep={lightboxMeta?.sequence_step}
                reason={lightboxMeta?.reason}
            />
        </div>
    );
}

// ─── Main Component ─────────────────────────────────────────────

export default function ExpertContent() {
    const router = useRouter();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [inputValue, setInputValue] = useState('');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [canScrollUp, setCanScrollUp] = useState(false);
    const [canScrollDown, setCanScrollDown] = useState(false);
    const [sidebarRefreshing, setSidebarRefreshing] = useState(false);
    const [pendingImage, setPendingImage] = useState<string | null>(null);
    const [imageError, setImageError] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { user, loading: authLoading } = useAuth();

    const {
        messages,
        solution,
        isTyping,
        sidebarState,
        resetSession,
        sendMessage,
        generateSolution,
        initSessionListener,
    } = useExpertStore();

    // Sidebar refreshing: starts when user sends (isTyping), stops when analyzer writes new sidebarState
    useEffect(() => {
        if (isTyping) setSidebarRefreshing(true);
    }, [isTyping]);

    useEffect(() => {
        if (sidebarState) setSidebarRefreshing(false);
    }, [sidebarState]);

    // Init real-time listener
    useEffect(() => {
        initSessionListener();
    }, [initSessionListener]);


    // Auto-scroll to bottom of messages container
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [messages, isTyping]);

    // Track scroll position for fade gradients
    const updateScrollIndicators = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const threshold = 8; // px tolerance
        setCanScrollUp(el.scrollTop > threshold);
        setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - threshold);
    }, []);

    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        el.addEventListener('scroll', updateScrollIndicators, { passive: true });
        // Initial check
        updateScrollIndicators();
        return () => el.removeEventListener('scroll', updateScrollIndicators);
    }, [updateScrollIndicators]);

    // Re-check indicators when messages change (content height changes)
    useEffect(() => {
        updateScrollIndicators();
    }, [messages, isTyping, solution, updateScrollIndicators]);

    const status = deriveStatus(messages.length > 0, isTyping, solution);

    // Derive sidebar data from sidebarState (AI-produced)
    const { steps: progressSteps, progress } = deriveProgressFromSidebar(sidebarState, isTyping, solution);

    const handleSend = useCallback(async () => {
        const trimmed = inputValue.trim();
        if (!trimmed && !pendingImage) return;

        // Ensure the user is logged in before allowing them to send a message
        if (!authLoading && !user) {
            router.push('/login?redirect=/expert');
            return;
        }

        let imageUrl: string | undefined = undefined;

        if (pendingImage) {
            setIsUploading(true);
            try {
                imageUrl = await uploadImageToStorage(pendingImage, useExpertStore.getState().sessionId);
            } catch (err) {
                console.error('Failed to upload image', err);
                setImageError('Αποτυχία μεταφόρτωσης εικόνας. Προσπαθήστε ξανά.');
                setIsUploading(false);
                return;
            }
            setIsUploading(false);
        }

        sendMessage(trimmed || '📷 Απεστάλη φωτογραφία', imageUrl);
        setInputValue('');
        setPendingImage(null);
        setImageError(null);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    }, [inputValue, pendingImage, sendMessage, user, authLoading, router]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend],
    );

    // Auto-resize textarea
    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    };

    // Idle-state suggestions
    const idleSuggestions = [
        'Surface corrosion on steel',
        'High-humidity coating',
        'Marine coating system',
    ];

    return (
        /*
         * Chat-app layout shell
         * ─────────────────────
         * Fixed to fill the viewport below the header (≈64px).
         * Uses `dvh` so mobile browser chrome (address bar) is accounted for.
         * The negative margins neutralise the parent <main>'s gap & mb classes.
         */
        <div className="flex w-full h-[calc(100dvh-64px)] overflow-hidden -mb-16">
            {/* ──────── Desktop Sidebar ──────── */}
            <aside data-lenis-prevent="true" className="hidden md:flex w-80 flex-shrink-0 border-r border-border flex-col overflow-y-auto custom-scrollbar p-6">
                <SidebarContent steps={progressSteps} progress={progress} sidebarState={sidebarState} sidebarRefreshing={sidebarRefreshing} />
            </aside>

            {/* ──────── Mobile Sidebar Drawer ──────── */}
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetContent data-lenis-prevent="true" side="left" className="w-80 p-6 overflow-y-auto">
                    <SheetTitle className="sr-only">Project Status</SheetTitle>
                    <SheetDescription className="sr-only">
                        View project progress, technical logs, and recommended coatings
                    </SheetDescription>
                    <SidebarContent steps={progressSteps} progress={progress} sidebarState={sidebarState} sidebarRefreshing={sidebarRefreshing} />
                </SheetContent>
            </Sheet>

            {/* ──────── Main Chat Column ──────── */}
            <section className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* ─ Top toolbar (mobile sidebar toggle + reset) ─ */}
                <div className="flex-shrink-0 flex items-center justify-between md:justify-end gap-2 px-4 sm:px-6 md:px-10 py-3 border-b border-border bg-background/60 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="md:hidden inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-secondary border border-border hover:bg-muted transition-colors"
                            aria-label="Open project panel"
                        >
                            <PanelLeftOpen className="w-4 h-4" />
                            <span>Status</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        {messages.length > 0 && (
                            <button
                                onClick={resetSession}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-muted-foreground hover:text-destructive bg-secondary border border-border transition-colors"
                            >
                                <RotateCcw className="w-3 h-3" />
                                <span className="hidden sm:inline">New Session</span>
                                <span className="sm:hidden">New</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* ─ Scrollable messages area with fade gradients ─ */}
                <div className="flex-1 relative overflow-hidden">
                    {/* Top fade gradient — visible when scrolled down */}
                    <div
                        className={`absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none transition-opacity duration-200 ${canScrollUp ? 'opacity-100' : 'opacity-0'
                            }`}
                    />

                    {/* Bottom fade gradient — visible when more content below */}
                    <div
                        className={`absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none transition-opacity duration-200 ${canScrollDown ? 'opacity-100' : 'opacity-0'
                            }`}
                    />

                    <div
                        ref={scrollContainerRef}
                        data-lenis-prevent="true"
                        className="h-full overflow-y-auto custom-scrollbar px-4 sm:px-6 md:px-10 pt-6 pb-4"
                    >
                        {/* ── IDLE: Welcome screen ── */}
                        {status === 'idle' && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex flex-col items-center justify-center h-full text-center space-y-6 py-8"
                            >
                                <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center">
                                    <Bot className="w-10 h-10 text-primary-foreground" />
                                </div>
                                <div className="space-y-2">
                                    <h2 className="text-2xl font-bold text-foreground tracking-tight">
                                        Industrial Coating Specialist
                                    </h2>
                                    <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
                                        Describe your surface, environment, and project requirements.
                                        I&apos;ll recommend the optimal coating system.
                                    </p>
                                </div>
                                <div className="flex gap-2 flex-wrap justify-center">
                                    {idleSuggestions.map((s) => (
                                        <QuickActionButton
                                            key={s}
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                if (!authLoading && !user) {
                                                    router.push('/login?redirect=/expert');
                                                    return;
                                                }
                                                sendMessage(s);
                                                setInputValue('');
                                            }}
                                        >
                                            {s}
                                        </QuickActionButton>
                                    ))}
                                </div>
                            </motion.div>
                        )}

                        {/* ── Chat message history ── */}
                        {messages.length > 0 && (
                            <div className="space-y-6 max-w-3xl mx-auto">
                                <AnimatePresence initial={false}>
                                    {messages.map((msg, idx) => {
                                        const isLast = idx === messages.length - 1;

                                        // Build actions for the last assistant message if it has suggestions
                                        const msgActions: Array<{ label: string; onClick: () => void }> = [];

                                        // If quick-action suggestions were included in the message
                                        if (msg.role === 'assistant' && msg.question?.options) {
                                            msg.question.options.forEach((opt: string) => {
                                                msgActions.push({
                                                    label: opt,
                                                    onClick: () => {
                                                        if (!authLoading && !user) {
                                                            router.push('/login?redirect=/expert');
                                                            return;
                                                        }
                                                        sendMessage(opt);
                                                    },
                                                });
                                            });
                                        }

                                        return (
                                            <motion.div
                                                key={msg.id}
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ duration: 0.25 }}
                                            >
                                                <ChatMessage
                                                    variant={msg.role === 'assistant' ? 'assistant' : 'user'}
                                                    senderName={
                                                        msg.role === 'assistant'
                                                            ? 'Pavlicevits AI Support'
                                                            : 'Site Engineer'
                                                    }
                                                    content={
                                                        <>
                                                            {/* Inline image thumbnail for user messages */}
                                                            {msg.image_url && (
                                                                <div className="mb-2">
                                                                    <img
                                                                        src={msg.image_url}
                                                                        alt="Uploaded photo"
                                                                        className="max-w-[200px] max-h-[150px] rounded-md border border-border/50 object-cover"
                                                                    />
                                                                </div>
                                                            )}
                                                            <span
                                                                dangerouslySetInnerHTML={{
                                                                    __html: msg.content
                                                                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                                                        .replace(/\n/g, '<br />'),
                                                                }}
                                                            />
                                                        </>
                                                    }
                                                    actions={msgActions.length > 0 ? msgActions : undefined}
                                                />

                                                {/* Ready for solution CTA — driven by context analyzer */}
                                                {isLast && sidebarState?.showSolutionButton && !solution && !isTyping && (
                                                    <div className="ml-13 mt-3">
                                                        <button
                                                            onClick={generateSolution}
                                                            className="btn-accent px-5 py-2.5 text-sm rounded-md font-semibold"
                                                        >
                                                            <Zap className="w-4 h-4 mr-2 inline" />
                                                            Generate Solution Plan
                                                        </button>
                                                    </div>
                                                )}
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>
                        )}

                        {/* ── THINKING: Typing indicator ── */}
                        {status === 'thinking' && (
                            <div className="max-w-3xl mx-auto mt-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                                        <Bot className="w-5 h-5 text-primary-foreground" />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                            Pavlicevits AI Support
                                        </span>
                                        <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-card border border-border">
                                            <div className="flex gap-1">
                                                <span className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:0ms]" />
                                                <span className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:150ms]" />
                                                <span className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:300ms]" />
                                            </div>
                                        </div>
                                        <button
                                            onClick={useExpertStore.getState().abortSession}
                                            className="self-start text-xs font-semibold text-destructive hover:text-destructive/80 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── COMPLETE: Solution CTA ── */}
                        {status === 'complete' && solution && (
                            <motion.div
                                initial={{ opacity: 0, y: 24 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="max-w-3xl mx-auto mt-6 card p-6 border-2 border-accent/20 space-y-5"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                                        <CheckCircle2 className="w-7 h-7 text-accent-foreground" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground tracking-tight">
                                            {solution.title}
                                        </h3>
                                        <p className="text-muted-foreground font-medium text-sm">
                                            {solution.totalProducts > 0
                                                ? `${solution.totalProducts} products • ${formatPrice(solution.totalPrice)}`
                                                : 'Custom solution plan ready'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => router.push('/solution')}
                                    className="btn-primary w-full py-4 text-sm font-semibold rounded-md"
                                >
                                    View Your Custom Solution Plan
                                    <ChevronRight className="w-4 h-4 ml-2 inline" />
                                </button>
                            </motion.div>
                        )}

                        {/* Scroll anchor */}
                        <div ref={messagesEndRef} className="h-1" />
                    </div>
                </div>

                {/* ─ Bottom Input Bar (always pinned, never scrolls) ─ */}
                <div className="flex-shrink-0 border-t border-border bg-background/80 backdrop-blur-sm p-3 sm:p-4 md:px-10">
                    <div className="max-w-3xl mx-auto relative">
                        <textarea
                            ref={textareaRef}
                            value={inputValue}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                            placeholder="Περιγράψτε το έργο σας ή ρωτήστε τεχνικά..."
                            rows={1}
                            className="w-full bg-card border border-border rounded-lg px-4 py-3 pr-24 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-all placeholder:text-muted-foreground min-h-[48px]"
                        />

                        {/* Pending image thumbnail strip */}
                        {pendingImage && (
                            <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-card border border-border animate-in fade-in duration-150">
                                <img
                                    src={pendingImage}
                                    alt="Pending upload"
                                    className="w-12 h-12 rounded object-cover border border-border"
                                />
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <ImageIcon className="w-3 h-3" />
                                    Φωτογραφία έτοιμη
                                </span>
                                <button
                                    type="button"
                                    onClick={() => { setPendingImage(null); setImageError(null); }}
                                    className="ml-auto p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                    aria-label="Remove image"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}

                        {/* Image error */}
                        {imageError && (
                            <p className="text-xs text-destructive mt-1">{imageError}</p>
                        )}

                        {/* Hidden file input for Paperclip */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const validation = validateImageFile(file);
                                if (!validation.valid) {
                                    setImageError(validation.error ?? 'Invalid file');
                                    return;
                                }
                                try {
                                    const base64 = await resizeImageToBase64(file);
                                    setPendingImage(base64);
                                    setImageError(null);
                                } catch {
                                    setImageError('Αδυναμία επεξεργασίας εικόνας.');
                                }
                                // Reset input so same file can be re-selected
                                e.target.value = '';
                            }}
                        />

                        <div className="absolute right-3 bottom-2.5 flex items-center gap-1">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="p-2 text-muted-foreground hover:text-accent transition-colors rounded-md hover:bg-secondary"
                                aria-label="Attach photo"
                                type="button"
                            >
                                <Paperclip className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={(!inputValue.trim() && !pendingImage) || isUploading}
                                className="p-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                aria-label="Send message"
                            >
                                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {/* Status Indicators */}
                    <div className="max-w-3xl mx-auto mt-2 flex items-center justify-center gap-4 sm:gap-6 flex-wrap">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Engine Online
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            ISO Compliance V2.4
                        </span>
                        <button className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent hover:underline transition-colors">
                            <Zap className="w-3 h-3" />
                            Generate PDF Report
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}

