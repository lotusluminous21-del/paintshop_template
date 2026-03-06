"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { signInWithGoogle } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { User, Layers } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IndexedFadeInUp } from '@/components/ui/motion';

export default function LoginPage() {
    return (
        <React.Suspense fallback={
            <div className="flex-1 flex items-center justify-center min-h-[60vh] bg-background">
                <div className="w-[50px] h-[50px] rounded-full border-[4px] border-secondary border-t-primary animate-spin shadow-sm"></div>
            </div>
        }>
            <LoginContent />
        </React.Suspense>
    );
}

function LoginContent() {
    const { user, loading } = useAuth();
    const [isSigningIn, setIsSigningIn] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();

    React.useEffect(() => {
        if (!loading && user) {
            const redirectParams = searchParams?.get('redirect');
            if (redirectParams) {
                router.push(redirectParams);
            } else {
                router.push('/profile');
            }
        }
    }, [user, loading, router, searchParams]);

    const handleLogin = async () => {
        setIsSigningIn(true);
        try {
            await signInWithGoogle();
        } catch (error) {
            console.error(error);
            setIsSigningIn(false);
        }
    };

    if (loading || user) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[60vh] bg-background">
                <div className="w-[50px] h-[50px] rounded-full border-[4px] border-secondary border-t-primary animate-spin shadow-sm"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col items-center justify-center min-h-[70vh] text-center px-4 bg-background">
            <IndexedFadeInUp index={0}>
                <div className="w-24 h-24 bg-white border border-border flex items-center justify-center mb-8 shadow-sm group hover:border-primary transition-colors cursor-default rounded-2xl mx-auto">
                    <User className="w-10 h-10 text-muted-foreground group-hover:text-primary transition-colors" strokeWidth={1.5} />
                </div>
            </IndexedFadeInUp>
            <IndexedFadeInUp index={1}>
                <h1 className="text-4xl font-black text-foreground uppercase tracking-tighter mb-4">Account Access</h1>
                <p className="text-sm font-bold text-muted-foreground mb-10 max-w-sm uppercase tracking-widest leading-relaxed mx-auto">
                    Authenticate to manage your project configurations, track orders, and access technical specs.
                </p>
            </IndexedFadeInUp>

            <IndexedFadeInUp index={2}>
                <div className="w-full max-w-[320px] mx-auto">
                    <Button
                        onClick={handleLogin}
                        disabled={isSigningIn}
                        className="w-full text-[10px] tracking-widest uppercase font-black bg-primary text-primary-foreground hover:opacity-90 transition-opacity rounded-none"
                        size="lg"
                    >
                        {isSigningIn ? "Authorizing..." : "Authenticate with Google"}
                    </Button>
                </div>
            </IndexedFadeInUp>
        </div>
    );
}
