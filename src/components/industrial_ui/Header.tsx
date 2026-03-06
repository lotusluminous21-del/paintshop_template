"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Layers, Search, ShoppingCart, User, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth-context';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from '@/components/ui/sheet';
import { motion } from 'framer-motion';

export interface HeaderProps {
    className?: string;
}

export function Header({ className }: HeaderProps) {
    const { user, loading } = useAuth();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const navItems = [
        { label: 'Shop', href: '/categories', description: 'Εξερευνήστε τις συλλογές μας' },
        { label: 'AI Expert', href: '/expert', description: 'Διαδραστικός βοηθός αγορών AI' },
        { label: 'Services', href: '/services', description: 'Εξειδικευμένη κατασκευή & άλλα' },
        { label: 'About', href: '/about', description: 'Η ιστορία και η αποστολή μας' },
        { label: 'Contact', href: '/contact', description: 'Επικοινωνήστε μαζί μας' },
    ];

    return (
        <header className={cn(
            "border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50",
            className
        )}>
            <div className="max-w-7xl mx-auto w-full px-6 md:px-10 py-4 flex items-center justify-between whitespace-nowrap">
                <div className="flex items-center gap-6 lg:gap-12">
                    <Link href="/" className="flex items-center gap-3">
                        <div className="bg-primary p-1.5 rounded">
                            <Layers className="text-primary-foreground w-6 h-6" />
                        </div>
                        <h2 className="text-xl font-black uppercase tracking-tighter text-foreground">Pavlicevits</h2>
                    </Link>

                    <nav className="hidden lg:flex items-center gap-8">
                        {navItems.map((item) => (
                            <Link
                                key={item.label}
                                href={item.href}
                                className="text-muted-foreground hover:text-accent text-sm font-semibold uppercase tracking-wider transition-colors"
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="flex items-center gap-4 lg:gap-6">
                    <div className="hidden sm:flex items-center bg-secondary rounded-lg px-3 py-1.5 border border-border">
                        <Search className="text-muted-foreground w-5 h-5" />
                        <Input
                            className="bg-transparent border-none focus-visible:ring-0 shadow-none text-sm w-32 lg:w-48 placeholder:text-muted-foreground h-auto py-0"
                            placeholder="Search catalog..."
                            type="text"
                        />
                    </div>

                    <Link href="/cart" className="relative p-2 text-foreground hover:bg-secondary rounded-lg transition-colors">
                        <ShoppingCart className="w-6 h-6" />
                        <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full"></span>
                    </Link>

                    <Link
                        href="/profile"
                        prefetch={false}
                        className="flex w-10 h-10 rounded-full border border-border bg-muted items-center justify-center overflow-hidden hover:border-primary transition-colors shadow-sm"
                        title={user ? "Account Dashboard" : "Sign In"}
                    >
                        {loading ? (
                            <div className="w-4 h-4 rounded-full border-[2px] border-muted-foreground/20 border-t-muted-foreground animate-spin"></div>
                        ) : user ? (
                            user.photoURL ? (
                                <img src={user.photoURL} alt={user.displayName || "User"} className="w-full h-full object-cover grayscale" />
                            ) : (
                                <span className="text-sm font-black text-slate-500">{user.email?.[0].toUpperCase() || 'U'}</span>
                            )
                        ) : (
                            <User className="w-5 h-5 text-muted-foreground" />
                        )}
                    </Link>

                    <div className="lg:hidden flex items-center">
                        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                            <SheetTrigger asChild>
                                <button className="p-2 -mr-2 text-foreground hover:bg-secondary rounded-lg transition-colors">
                                    <Menu className="w-6 h-6" />
                                </button>
                            </SheetTrigger>
                            <SheetContent side="right" className="w-[100vw] sm:w-[500px] p-0 border-l border-border/50 bg-background/95 backdrop-blur-3xl shadow-2xl flex flex-col">
                                <SheetHeader className="px-8 py-8 border-b border-border/10 flex-shrink-0">
                                    <SheetTitle className="text-left flex items-center gap-3">
                                        <div className="bg-primary p-1.5 rounded">
                                            <Layers className="text-primary-foreground w-5 h-5" />
                                        </div>
                                        <span className="font-black uppercase tracking-tighter text-2xl text-foreground">
                                            Pavlicevits
                                        </span>
                                    </SheetTitle>
                                </SheetHeader>
                                <div className="flex-1 overflow-y-auto px-8 py-10 flex flex-col">
                                    <nav className="flex flex-col gap-6 mt-auto mb-auto">
                                        {navItems.map((item, i) => (
                                            <motion.div
                                                key={item.label}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: 0.1 + (0.05 * i), duration: 0.4, ease: "easeOut" }}
                                            >
                                                <Link
                                                    href={item.href}
                                                    onClick={() => setIsMobileMenuOpen(false)}
                                                    className="group flex flex-col pt-4 pb-2 border-b border-transparent hover:border-border/30 transition-colors"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-foreground text-3xl sm:text-5xl font-black uppercase tracking-tighter transition-colors group-hover:text-primary">
                                                            {item.label}
                                                        </span>
                                                        <span className="text-primary opacity-0 group-hover:opacity-100 transition-all transform -translate-x-4 group-hover:translate-x-0 duration-300">
                                                            →
                                                        </span>
                                                    </div>
                                                    <span className="text-muted-foreground text-xs font-semibold mt-2 max-w-[80%] uppercase tracking-[0.2em]">
                                                        {item.description}
                                                    </span>
                                                </Link>
                                            </motion.div>
                                        ))}
                                    </nav>
                                </div>
                                <div className="px-8 py-6 border-t border-border/10 bg-muted/10 flex-shrink-0 mt-auto">
                                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                                        <span>© 2026 Pavlicevits</span>
                                        <Link href="/contact" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-primary transition-colors">Get Support</Link>
                                    </div>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>
            </div>
        </header>
    );
}
