'use client';

/**
 * ExpertContent — AI Expert Assistant Screen (V4)
 * 4-stage pipeline: Interviewer → Query Planner → Retriever → Expert Synthesizer
 * Sidebar shows interview progress + pipeline status.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { useExpertStore } from '@/lib/expert/store';
import type { SidebarState, InterviewProgress } from '@/lib/expert/types';

import {
    Sheet,
    SheetContent,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, CheckCircle2, Circle, Clock } from 'lucide-react';
import Link from 'next/link';

// New chat components
import { ChatHeader } from '@/components/expert_chat/ChatHeader';
import { ChatComposer } from '@/components/expert_chat/ChatComposer';
import { ChatMessageBubble, seedRevealedMessages } from '@/components/expert_chat/ChatMessage';
import { WelcomeScreen } from '@/components/expert_chat/WelcomeScreen';

// ─── V4 Constants ──────────────────────────────────────────

const OVERALL_PHASE_LABELS: Record<string, string> = {
    interviewing: 'Συνέντευξη',
    ready_for_plan: 'Έτοιμο για Πλάνο',
    planning: 'Δημιουργία Πλάνου',
    retrieving: 'Αναζήτηση Προϊόντων',
    synthesizing: 'Ανάλυση Ειδικού',
    complete: 'Ολοκλήρωση',
};

const INTERVIEW_DIMENSION_LABELS: Record<keyof InterviewProgress, string> = {
    what: 'Τι βάφουμε',
    why: 'Γιατί / Κατάσταση',
    how: 'Μέθοδος Εφαρμογής',
    where: 'Περιβάλλον',
    result: 'Επιθυμητό Αποτέλεσμα',
};
// ─── Sidebar ──────────────────────────────────────────

import { motion, AnimatePresence } from 'framer-motion';

interface SidebarProps {
    sidebarState: SidebarState | null;
    isGenerating?: boolean;
    pipelineStage?: string;
}

function SidebarContent({ sidebarState, isGenerating, pipelineStage }: SidebarProps) {
    const interviewProgress = sidebarState?.interviewProgress;
    const briefReadiness = sidebarState?.briefReadiness ?? 0;
    const dimensions = sidebarState?.knowledgeDimensions || [];
    const hasDimensions = dimensions.length > 0;
    const logs = sidebarState?.logs || [];
    const currentPhase = sidebarState?.overallPhase || 'interviewing';
    const phaseLabel = sidebarState?.overallPhaseLabel || OVERALL_PHASE_LABELS[currentPhase] || 'Συνέντευξη';

    // Pipeline stage labels for the generating state
    const PIPELINE_STAGE_LABELS: Record<string, string> = {
        planning: 'Δημιουργία πλάνου αναζήτησης...',
        retrieving: 'Αναζήτηση κατάλληλων προϊόντων...',
        synthesizing: 'Ο Ειδικός αξιολογεί συμβατότητα...',
    };

    return (
        <div className="flex flex-col gap-8 h-full pb-10">
            {/* 1. Phase Header — Compact current stage + readiness */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="flex flex-col gap-3"
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isGenerating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                        ) : currentPhase === 'complete' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                        ) : (
                            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                        )}
                        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground">
                            {isGenerating ? (PIPELINE_STAGE_LABELS[pipelineStage || ''] || 'Επεξεργασία...') : phaseLabel}
                        </span>
                    </div>
                    {sidebarState?.domain && (
                        <span className="text-[9px] font-black tracking-tighter text-accent bg-accent/5 px-2 py-0.5 rounded border border-accent/10">
                            {sidebarState.domain.toUpperCase()}
                        </span>
                    )}
                </div>

                {/* Readiness bar — always visible during interview */}
                {currentPhase !== 'complete' && (
                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-1 rounded-full bg-secondary/60 overflow-hidden">
                            <motion.div
                                className="h-full rounded-full bg-accent"
                                initial={{ width: 0 }}
                                animate={{ width: `${(isGenerating ? 100 : briefReadiness * 100)}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' }}
                            />
                        </div>
                        <span className="text-[10px] font-black text-accent tabular-nums w-8 text-right">
                            {isGenerating ? '⚡' : `${Math.round(briefReadiness * 100)}%`}
                        </span>
                    </div>
                )}
            </motion.div>

            {/* 2. Interview Dimensions — 5 quality axes */}
            {interviewProgress && !isGenerating && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col gap-3"
                >
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                        ΠΛΗΡΟΤΗΤΑ ΣΥΝΕΝΤΕΥΞΗΣ
                    </h3>
                    <div className="space-y-2.5">
                        <AnimatePresence mode="popLayout">
                            {(Object.keys(INTERVIEW_DIMENSION_LABELS) as Array<keyof InterviewProgress>).map((key) => {
                                const dim = interviewProgress[key];
                                if (!dim) return null;
                                return (
                                    <motion.div
                                        key={key}
                                        layout
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="flex items-start gap-2"
                                    >
                                        <div className="mt-0.5">
                                            {dim.status === 'identified' ? (
                                                <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                                            ) : dim.status === 'pending' ? (
                                                <Clock className="w-3.5 h-3.5 text-primary animate-pulse" />
                                            ) : (
                                                <Circle className="w-3.5 h-3.5 text-muted-foreground/30" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className={cn(
                                                "text-[12px] font-semibold tracking-tight",
                                                dim.status === 'identified' ? 'text-foreground' : 'text-muted-foreground/70'
                                            )}>
                                                {INTERVIEW_DIMENSION_LABELS[key]}
                                            </span>
                                            {dim.value && dim.status === 'identified' && (
                                                <motion.span
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    className="ml-2 inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-accent/8 text-accent border border-accent/15 leading-none"
                                                >
                                                    {dim.value}
                                                </motion.span>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}

            {/* 3. Detailed Knowledge Dimensions (extras beyond the 5 core) */}
            {hasDimensions && !isGenerating && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col gap-3"
                >
                    <div className="h-px bg-gradient-to-r from-border/40 via-border/20 to-transparent" />
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                        ΤΕΧΝΙΚΑ ΣΤΟΙΧΕΙΑ
                    </h3>
                    <div className="space-y-2">
                        <AnimatePresence mode="popLayout">
                            {dimensions.map((dim) => (
                                <motion.div
                                    key={dim.id}
                                    layout
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="flex items-center gap-2"
                                >
                                    <div className={cn(
                                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                        dim.status === 'identified' ? 'bg-accent' :
                                            dim.status === 'pending' ? 'bg-primary/60 animate-pulse' : 'bg-muted/40'
                                    )} />
                                    <span className={cn(
                                        "text-[11px] tracking-tight",
                                        dim.status === 'identified' ? 'font-semibold text-foreground' : 'text-muted-foreground/60'
                                    )}>
                                        {dim.label}
                                    </span>
                                    {dim.value && dim.status === 'identified' && (
                                        <span className="ml-auto text-[10px] font-bold text-accent/80 truncate max-w-[120px]">
                                            {dim.value}
                                        </span>
                                    )}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}

            {/* 4. Pipeline Status — shown when generating */}
            {isGenerating && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col gap-4 p-4 rounded-xl bg-accent/5 border border-accent/15"
                >
                    <div className="space-y-3">
                        {['planning', 'retrieving', 'synthesizing'].map((stage) => {
                            const isActive = pipelineStage === stage;
                            const isPast = ['planning', 'retrieving', 'synthesizing'].indexOf(pipelineStage || '') > ['planning', 'retrieving', 'synthesizing'].indexOf(stage);
                            return (
                                <div key={stage} className="flex items-center gap-2.5">
                                    {isPast ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                                    ) : isActive ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                                    ) : (
                                        <Circle className="w-3.5 h-3.5 text-muted-foreground/30" />
                                    )}
                                    <span className={cn(
                                        "text-[11px] font-semibold",
                                        isPast ? 'text-accent' : isActive ? 'text-foreground' : 'text-muted-foreground/50'
                                    )}>
                                        {PIPELINE_STAGE_LABELS[stage]}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </motion.div>
            )}

            {/* 5. AI Log Strip */}
            {logs.length > 0 && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col gap-2 mt-auto"
                >
                    <div className="h-px bg-gradient-to-r from-border/40 via-border/20 to-transparent" />
                    <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-accent/40" />
                        LOGS
                    </h3>
                    <div className="space-y-1">
                        {logs.slice(-4).map((log, i) => (
                            <p key={i} className="text-[10px] text-muted-foreground/60 leading-tight font-mono">
                                {log.message}
                            </p>
                        ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}

// ─── Main Expert Page ─────────────────────────────────────────────

export default function ExpertContent() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const messageContainerRef = useRef<HTMLDivElement>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const { user, loading: authLoading } = useAuth();

    const {
        messages,
        solution,
        isTyping,
        sidebarState,
        pipelineStage,
        resetSession,
        sendMessage,
        generateSolution,
        initSessionListener,
    } = useExpertStore();

    useEffect(() => {
        initSessionListener();
    }, [initSessionListener]);

    // Seed revealed messages on mount so page-reload doesn't re-animate
    useEffect(() => {
        seedRevealedMessages(messages.map((m) => m.id));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Force strict overflow lock on body
    useEffect(() => {
        const originalHtmlOverflow = document.documentElement.style.overflow;
        const originalBodyOverflow = document.body.style.overflow;
        const originalBodyHeight = document.body.style.height;

        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100dvh';

        return () => {
            document.documentElement.style.overflow = originalHtmlOverflow;
            document.body.style.overflow = originalBodyOverflow;
            document.body.style.height = originalBodyHeight;
        };
    }, []);

    // Track scroll position to determine if we should follow the bottom
    const handleScroll = useCallback(() => {
        if (!messageContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = messageContainerRef.current;
        // If we are within 100px of the bottom, we consider it "at bottom"
        const atBottom = scrollHeight - scrollTop - clientHeight < 100;
        setIsAtBottom(atBottom);
    }, []);

    // Auto-scroll to bottom on new messages (force scroll for user's own messages)
    useEffect(() => {
        const container = messageContainerRef.current;
        if (!container) return;

        const lastMessage = messages[messages.length - 1];
        const isUserLast = lastMessage?.role === 'user';

        // If user just sent a message, ALWAYS scroll to bottom
        // Otherwise, only scroll if we were already at the bottom
        if (isUserLast || isAtBottom || isTyping) {
            setTimeout(() => {
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth',
                });
            }, 50);
        }
    }, [messages, isAtBottom, isTyping]);

    const isGenerating = pipelineStage === 'planning' || pipelineStage === 'retrieving' || pipelineStage === 'synthesizing';
    const showSolutionCTA = !!(sidebarState?.showSolutionButton) && !isGenerating && !solution;
    const showViewSolutionCTA = !!solution && !isGenerating;

    const handleSend = useCallback(
        (text: string) => {
            sendMessage(text);
        },
        [sendMessage],
    );

    const hasMessages = messages.length > 0;

    return (
        <div className="flex w-full h-[calc(100dvh-64px)] overflow-hidden">
            {/* Desktop Sidebar */}
            <aside data-lenis-prevent="true" className="hidden md:flex w-[340px] flex-shrink-0 border-r border-border flex-col overflow-hidden">
                <ScrollArea className="flex-1 p-5">
                    <SidebarContent
                        sidebarState={sidebarState}
                        isGenerating={isGenerating}
                        pipelineStage={pipelineStage}
                    />
                </ScrollArea>
            </aside>

            {/* Mobile Sidebar */}
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetContent data-lenis-prevent="true" side="left" className="w-80 p-0 flex flex-col">
                    <SheetTitle className="sr-only">Κατάσταση Έργου</SheetTitle>
                    <SheetDescription className="sr-only">
                        Δείτε την πρόοδο του έργου, τα τεχνικά ημερολόγια και τις προτεινόμενες επικαλύψεις.
                    </SheetDescription>
                    <ScrollArea className="flex-1 p-5">
                        <SidebarContent
                            sidebarState={sidebarState}
                            isGenerating={isGenerating}
                            pipelineStage={pipelineStage}
                        />
                    </ScrollArea>
                </SheetContent>
            </Sheet>

            {/* Chat Area */}
            <section className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <ChatHeader
                    hasMessages={hasMessages}
                    onReset={resetSession}
                    onOpenSidebar={() => setSidebarOpen(true)}
                />

                {/* Messages / Welcome */}
                <div className="flex-1 relative overflow-hidden bg-background">
                    {/* Welcome screen (empty state) */}
                    {!hasMessages && (
                        <div className="flex h-full">
                            <WelcomeScreen
                                visible={!hasMessages}
                                user={user}
                                authLoading={authLoading}
                            />
                        </div>
                    )}

                    {/* Message thread */}
                    {hasMessages && (
                        <div
                            ref={messageContainerRef}
                            onScroll={handleScroll}
                            className="h-full overflow-y-auto scroll-smooth p-4 sm:p-5 md:px-8 chat-scrollbar-hidden"
                        >
                            <div className="max-w-[800px] mx-auto space-y-8">
                                {messages.map((message, i) => (
                                    <ChatMessageBubble
                                        key={message.id}
                                        message={message}
                                        isLast={i === messages.length - 1}
                                        isTyping={isTyping}
                                    />
                                ))}

                                {/* Typing indicator when no assistant message yet */}
                                {isTyping && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                                    <div className="flex gap-2">
                                        <div className="flex-shrink-0 w-6 h-6 md:w-7 md:h-7 rounded-full bg-accent flex items-center justify-center shadow-sm">
                                            <span className="text-accent-foreground text-xs">✦</span>
                                        </div>
                                        <div className="rounded-2xl rounded-tl-sm px-3.5 py-2 bg-card border border-border/50">
                                            <div className="flex items-center space-x-1">
                                                <div className="w-1.5 h-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                                                <div className="w-1.5 h-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                                                <div className="w-1.5 h-1.5 animate-bounce rounded-full bg-muted-foreground/40" />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* In-chat Generate Solution CTA */}
                                {showSolutionCTA && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 16 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.5, ease: 'easeOut' }}
                                        className="flex justify-center py-2"
                                    >
                                        <button
                                            onClick={generateSolution}
                                            className="group relative flex items-center gap-3 px-6 py-3.5 rounded-2xl bg-accent text-accent-foreground font-bold text-sm shadow-lg hover:shadow-xl transition-all transform hover:scale-[1.03] active:scale-[0.97] overflow-hidden"
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-r from-accent via-accent-light to-accent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                            <Sparkles className="w-4.5 h-4.5 relative z-10" />
                                            <span className="relative z-10">Δημιουργία Εξατομικευμένου Πλάνου</span>
                                        </button>
                                    </motion.div>
                                )}

                                {/* In-chat View Solution CTA */}
                                {showViewSolutionCTA && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 16 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.5, ease: 'easeOut' }}
                                        className="flex justify-center py-2"
                                    >
                                        <Link
                                            href="/solution"
                                            className="group relative flex items-center gap-3 px-6 py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:shadow-xl transition-all transform hover:scale-[1.03] active:scale-[0.97] overflow-hidden"
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary/80 to-primary opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                            <Sparkles className="w-4.5 h-4.5 relative z-10" />
                                            <span className="relative z-10">Προβολή Εξατομικευμένου Πλάνου</span>
                                        </Link>
                                    </motion.div>
                                )}

                                {/* Pipeline generating indicator in chat */}
                                {isGenerating && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 16 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="flex gap-2"
                                    >
                                        <div className="flex-shrink-0 w-6 h-6 md:w-7 md:h-7 rounded-full bg-accent flex items-center justify-center shadow-sm">
                                            <Sparkles className="w-3 h-3 text-accent-foreground" />
                                        </div>
                                        <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-accent/5 border border-accent/20 flex items-center gap-2.5">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                                            <span className="text-[13px] font-semibold text-foreground">
                                                Ο Ειδικός αναλύει και ετοιμάζει το πλάνο σας...
                                            </span>
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                            {/* Spacer to keep content above the floating composer */}
                            <div className="h-40" aria-hidden="true" />
                        </div>
                    )}

                    {/* Gradient fade above composer */}
                    {hasMessages && (
                        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent pointer-events-none z-[5]" />
                    )}

                    {/* Floating Composer */}
                    <ChatComposer
                        onSend={handleSend}
                        isLoading={isTyping}
                    />
                </div>


            </section>
        </div>
    );
}
