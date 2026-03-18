// src/lib/expert/store.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KnowledgeState, ExpertChatResponse, SidebarState } from './types';
import { getFirebaseDb, getFirebaseAuth, getFirebaseFunctions } from '../firebase/config';
import { doc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { removeUndefined } from '../utils';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

// V3: No rigid knowledge state tracking locally

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
    id: string;
    role: MessageRole;
    content: string;
    timestamp: number;
    // Multimodal: remote Firebase Storage URL of the attached image
    image_url?: string;
    // Expanded data returned by the backend
    understanding_summary?: string;
    question?: any;
    clarification_needed?: string;
    ready_for_solution?: boolean;
    solution?: any;
    suggested_products?: any[];
    step_by_step_recipe?: string[];
    safety_warnings?: string[];
}

// V4: Sidebar types re-exported from types.ts
export type { SidebarState, KnowledgeDimension as SidebarKnowledgeDimension, SuggestedProduct as SidebarRecommendedProduct } from './types';

interface ExpertSystemState {
    sessionId: string;
    messages: ChatMessage[];
    isTyping: boolean;
    isSyncing: boolean;
    agentStatus: string;
    solution: ExpertChatResponse['solution'] | null;
    pipelineStage: '' | 'planning' | 'retrieving' | 'synthesizing' | 'complete' | 'error';
    sidebarState: SidebarState | null;
    _unsubscribeSnapshot?: Unsubscribe;

    // Actions
    addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
    sendMessage: (content: string, imageUrl?: string) => Promise<void>;
    setTyping: (typing: boolean) => void;
    setAgentStatus: (status: string) => void;
    setSolution: (solution: ExpertChatResponse['solution']) => void;
    resetSession: () => void;
    abortSession: () => Promise<void>;
    generateSolution: () => Promise<void>;
    syncWithFirestore: () => Promise<void>;
    initSessionListener: () => void;
}

const generateId = () => Math.random().toString(36).substring(7);

export const useExpertStore = create<ExpertSystemState>()(
    persist(
        (set, get) => ({
            sessionId: generateId(),
            messages: [],
            isTyping: false,
            isSyncing: false,
            agentStatus: "",
            solution: null,
            pipelineStage: '',
            sidebarState: null,
            addMessage: (msgInput) => {
                set((state) => ({
                    messages: [
                        ...state.messages,
                        {
                            ...msgInput,
                            id: generateId(),
                            timestamp: Date.now()
                        }
                    ]
                }));
                get().syncWithFirestore();
            },

            sendMessage: async (content, imageUrl?) => {
                const { addMessage } = get();

                // Add user message locally (with optional image)
                addMessage({
                    role: 'user',
                    content,
                    ...(imageUrl ? { image_url: imageUrl } : {}),
                });

                // Set initial status to give immediate feedback while function spins up
                set({ isTyping: true, agentStatus: "Προετοιμασία..." });

                // We NO LONGER AWAIT an http call.
                // The addMessage above calls syncWithFirestore() which pushes the message to Firestore.
                // Then, the Cloud Function triggers, processes the chat, and writes back.
                // The `initSessionListener` will pick up all changes live.
            },

            setTyping: (typing) => set({ isTyping: typing }),

            setAgentStatus: (status) => set({ agentStatus: status }),

            setSolution: (solution) => {
                set({ solution });
                get().syncWithFirestore();
            },

            resetSession: () => {
                const { _unsubscribeSnapshot } = get();
                if (_unsubscribeSnapshot) {
                    _unsubscribeSnapshot();
                }

                const newSessionId = generateId();
                set({
                    sessionId: newSessionId,
                    messages: [],
                    isTyping: false,
                    agentStatus: "",
                    solution: null,
                    pipelineStage: '',
                    sidebarState: null,
                    _unsubscribeSnapshot: undefined
                });

                // Re-initialize listener for the new session ID
                setTimeout(() => get().initSessionListener(), 0);
            },

            abortSession: async () => {
                const state = get();
                const auth = getFirebaseAuth();
                const user = auth.currentUser;

                if (user) {
                    try {
                        const db = getFirebaseDb();
                        const sessionRef = doc(db, 'users', user.uid, 'expert_sessions', state.sessionId);

                        // Set the abort signal for the backend to catch
                        await setDoc(sessionRef, {
                            status: 'aborting',
                            agentStatus: 'Διακοπή...',
                            updatedAt: new Date().toISOString()
                        }, { merge: true });

                        set({ isTyping: false });
                    } catch (error) {
                        console.error("Failed to abort expert session:", error);
                    }
                }
            },

            generateSolution: async () => {
                const state = get();
                const auth = getFirebaseAuth();
                const user = auth.currentUser;

                if (!user) return;

                set({ isTyping: true, agentStatus: "Δημιουργία πλάνου..." });

                try {
                    const functions = getFirebaseFunctions();
                    const generateFn = httpsCallable(functions, 'generate_expert_solution_v4');
                    await generateFn({ sessionId: state.sessionId, userId: user.uid });
                } catch (error) {
                    console.error("Failed to generate solution:", error);
                    set({ isTyping: false });
                }
            },

            syncWithFirestore: async () => {
                const state = get();
                if (state.isSyncing) return;

                try {
                    set({ isSyncing: true });
                    const auth = getFirebaseAuth();
                    const user = auth.currentUser;

                    if (user) {
                        const db = getFirebaseDb();
                        const sessionRef = doc(db, 'users', user.uid, 'expert_sessions', state.sessionId);

                        const payload = removeUndefined({
                            sessionId: state.sessionId,
                            messages: state.messages,
                            updatedAt: new Date().toISOString()
                        });

                        await setDoc(sessionRef, payload, { merge: true });
                    }
                } catch (error) {
                    console.error("Failed to sync expert store with Firestore:", error);
                } finally {
                    set({ isSyncing: false });
                }
            },

            initSessionListener: () => {
                const state = get();
                // Clean up previous listener to prevent leaks
                if (state._unsubscribeSnapshot) {
                    state._unsubscribeSnapshot();
                }

                const auth = getFirebaseAuth();
                const user = auth.currentUser;

                if (user) {
                    const db = getFirebaseDb();
                    const sessionRef = doc(db, 'users', user.uid, 'expert_sessions', state.sessionId);

                    const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
                        if (docSnap.exists()) {
                            const data = docSnap.data();

                            // 1. Update live typing and agent internal status updates
                            if (data.status === 'processing') {
                                set({ isTyping: true, agentStatus: data.agentStatus || "Επεξεργασία..." });
                            } else {
                                set({ isTyping: false, agentStatus: "" });
                            }

                            // 2. Sync incoming messages (only if there are new ones safely)
                            if (data.messages && Array.isArray(data.messages)) {
                                const currentMessages = get().messages;
                                // Simple merge: if firestore has more messages, update local state
                                if (data.messages.length > currentMessages.length) {
                                    set({ messages: data.messages });
                                }

                                // 3. Auto-populate solution if it arrived in the last assistant message
                                const latestMsg = data.messages[data.messages.length - 1];
                                if (latestMsg && latestMsg.role === 'assistant' && latestMsg.solution) {
                                    set({ solution: latestMsg.solution });
                                }
                            }

                            // 4. Sync pipeline stage
                            if (data.pipelineStage) {
                                set({ pipelineStage: data.pipelineStage });
                            }

                            // 5. Sync sidebar state (written by context_analysis_trigger)
                            if (data.sidebarState && typeof data.sidebarState === 'object') {
                                set({ sidebarState: data.sidebarState as SidebarState });
                            }
                        }
                    });

                    set({ _unsubscribeSnapshot: unsubscribe });
                }
            }
        }),
        {
            name: 'pavlicevits-expert-session', // LocalStorage Key
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                sessionId: state.sessionId,
                messages: state.messages,
                pipelineStage: state.pipelineStage,
                solution: state.solution,
                sidebarState: state.sidebarState,
            }), // Only persist these
        }
    )
);

// Initialize auth listener to sync when user logs in
if (typeof window !== 'undefined') {
    const auth = getFirebaseAuth();
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const store = useExpertStore.getState();
            // Sync messages and then immediately set up the real-time listener.
            // This ensures the snapshot is active even if initSessionListener
            // was called before auth resolved (mount-time race condition).
            await store.syncWithFirestore();
            store.initSessionListener();
        }
    });
}

