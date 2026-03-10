"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutGrid,
    LogOut,
    Menu,
    Search,
    Bell,
    ChevronRight,
    Home,
    Settings,
    ActivitySquare,
    PackageSearch,
    Terminal
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import React from "react";

interface AdminLayoutProps {
    children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
    const pathname = usePathname();
    const [isMobileOpen, setIsMobileOpen] = React.useState(false);

    const navItems = [
        {
            title: "Catalogue",
            href: "/admin/products",
            icon: LayoutGrid
        },
        {
            title: "Lab (Monolith)",
            href: "/admin/lab",
            icon: PackageSearch
        },
        {
            title: "System Logs",
            href: "/admin/logs",
            icon: Terminal
        }
    ];

    const NavContent = () => (
        <div className="flex flex-col h-full bg-white text-zinc-950">
            {/* Logo Area */}
            <div className="h-14 flex items-center px-4 border-b border-zinc-200 shrink-0">
                <Link href="/admin" className="flex items-center gap-2 font-medium text-lg tracking-tight hover:opacity-80 transition-opacity">
                    <div className="w-6 h-6 bg-zinc-900 rounded-md flex items-center justify-center text-white text-xs font-bold">
                        L
                    </div>
                    <span>Lab</span>
                </Link>
            </div>

            {/* Navigation Links */}
            <ScrollArea className="flex-1 py-4 px-3">
                <div className="space-y-1">
                    {navItems.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setIsMobileOpen(false)}
                            >
                                <Button
                                    variant="ghost"
                                    className={cn(
                                        "w-full justify-start gap-3 h-9 font-medium transition-colors text-sm",
                                        isActive
                                            ? "bg-zinc-100 text-zinc-900"
                                            : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/50"
                                    )}
                                >
                                    <item.icon className={cn("w-4 h-4", isActive ? "text-zinc-900" : "text-zinc-400")} />
                                    {item.title}
                                </Button>
                            </Link>
                        );
                    })}
                </div>

                {/* System Status / Secondary Links */}
                <div className="mt-8">
                    <h4 className="px-4 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">System</h4>
                    <div className="space-y-1">
                        <Button variant="ghost" className="w-full justify-start gap-3 h-8 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/50">
                            <ActivitySquare className="w-3.5 h-3.5 text-zinc-400" />
                            Activity Log
                        </Button>
                        <Button variant="ghost" className="w-full justify-start gap-3 h-8 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/50">
                            <Settings className="w-3.5 h-3.5 text-zinc-400" />
                            Settings
                        </Button>
                    </div>
                </div>
            </ScrollArea>

            {/* User Footer */}
            <div className="p-3 border-t border-zinc-200 mt-auto bg-zinc-50/50">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="w-full justify-start gap-2 h-10 hover:bg-zinc-100 px-2 transition-all">
                            <Avatar className="h-6 w-6 border border-zinc-200">
                                <AvatarFallback className="bg-zinc-100 text-xs text-zinc-600">AD</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col items-start overflow-hidden">
                                <span className="text-xs font-medium text-zinc-900 truncate w-full content-start text-left">Admin User</span>
                            </div>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 p-1 border-zinc-200 shadow-sm rounded-lg">
                        <DropdownMenuItem className="text-xs focus:bg-zinc-100 cursor-pointer rounded-md">Profile</DropdownMenuItem>
                        <DropdownMenuItem className="text-xs focus:bg-zinc-100 cursor-pointer rounded-md">Settings</DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-zinc-200" />
                        <DropdownMenuItem className="text-xs text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer flex items-center gap-2 rounded-md">
                            <LogOut className="w-3 h-3" /> Log out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-white flex text-zinc-950">
            {/* Desktop Sidebar - Slimmer & cleaner */}
            <aside className="hidden lg:flex w-56 flex-col fixed inset-y-0 left-0 bg-white border-r border-zinc-200 z-50">
                <NavContent />
            </aside>

            {/* Mobile Sidebar */}
            <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
                <SheetContent side="left" className="p-0 bg-white w-64 border-r border-zinc-200">
                    <NavContent />
                </SheetContent>
            </Sheet>

            {/* Main Content Area */}
            <main className="flex-1 lg:ml-56 flex flex-col h-full h-[100dvh] overflow-hidden bg-zinc-50/30">

                {/* Minimalist Header */}
                <header className="h-14 shrink-0 bg-white border-b border-zinc-200 z-40 px-4 lg:px-6 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1">
                        <Button variant="ghost" size="icon" className="lg:hidden -ml-2 text-zinc-500 hover:text-zinc-900" onClick={() => setIsMobileOpen(true)}>
                            <Menu className="w-4 h-4" />
                        </Button>

                        <div className="hidden md:flex items-center text-xs font-medium text-zinc-500">
                            <Link href="/admin" className="hover:text-zinc-900 transition-colors">
                                Home
                            </Link>
                            {pathname !== "/admin" && (
                                <>
                                    <ChevronRight className="w-3.5 h-3.5 text-zinc-300 mx-1.5" />
                                    <span className="text-zinc-900 capitalize">{pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')}</span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative hidden sm:block">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                            <Input
                                placeholder="Search..."
                                className="pl-8 w-56 h-8 bg-zinc-100/50 border-transparent focus:bg-white focus:border-zinc-300 focus:ring-0 transition-all text-xs rounded-md shadow-none"
                            />
                        </div>

                        <Button variant="ghost" size="icon" className="relative text-zinc-500 hover:text-zinc-900 w-8 h-8 rounded-md hover:bg-zinc-100">
                            <Bell className="w-4 h-4" />
                            {/* Example active dot */}
                            <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-zinc-900 rounded-full ring-2 ring-white"></span>
                        </Button>
                    </div>
                </header>

                {/* Content Frame */}
                <div 
                    id="admin-content-frame"
                    className={cn(
                        "flex-1 overflow-auto overscroll-contain",
                        (pathname.includes('/wizard') || pathname.includes('/lab')) ? "p-0" : "p-4 md:p-6 lg:p-8"
                    )}
                >
                    {/* We no longer constrain max-width strictly to allow datatables to breathe, 
                        but we provide sensible padding. */}
                    {children}
                </div>
            </main>
        </div>
    );
}
