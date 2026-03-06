"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth-context";
import { signInWithGoogle, signOutUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchCustomerProfile } from "@/app/actions/customer";
import {
    LayoutDashboard,
    Package,
    Bookmark,
    FileText,
    Settings,
    Factory,
    Banknote,
    ShieldCheck,
    LogOut,
    User as UserIcon,
    ArrowLeftFromLine,
    Inbox,
    FileImage
} from "lucide-react";

type Tab = 'overview' | 'orders' | 'projects' | 'docs' | 'settings';

export default function ProfilePage() {
    const { user, profile, loading: authLoading } = useAuth();
    const [isSigningIn, setIsSigningIn] = React.useState(false);

    const [customerData, setCustomerData] = React.useState<any>(null);
    const [dataLoading, setDataLoading] = React.useState(false);

    const [activeTab, setActiveTab] = React.useState<Tab>('overview');

    React.useEffect(() => {
        if (user?.email) {
            setDataLoading(true);
            fetchCustomerProfile(user.email).then((data) => {
                setCustomerData(data);
                setDataLoading(false);
            });
        }
    }, [user]);

    const handleLogin = async () => {
        setIsSigningIn(true);
        try {
            await signInWithGoogle();
        } catch (error) {
            console.error(error);
        }
        setIsSigningIn(false);
    };

    const handleLogout = async () => {
        try {
            await signOutUser();
        } catch (error) {
            console.error(error);
        }
    };

    if (authLoading || (user && dataLoading && !customerData)) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[60vh] bg-slate-50">
                <div className="w-[50px] h-[50px] rounded-full border-[4px] border-slate-200 border-t-[#165c52] animate-spin shadow-sm"></div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center min-h-[70vh] text-center px-4 bg-slate-50">
                <div className="w-24 h-24 bg-white border border-slate-200 flex items-center justify-center mb-8 shadow-sm group hover:border-[#165c52] transition-colors cursor-default">
                    <UserIcon className="w-10 h-10 text-slate-400 group-hover:text-[#165c52] transition-colors" strokeWidth={1.5} />
                </div>
                <h1 className="text-4xl font-black text-slate-900 uppercase tracking-tighter mb-4">Account Access</h1>
                <p className="text-sm font-bold text-slate-500 mb-10 max-w-sm uppercase tracking-widest leading-relaxed">
                    Log in to manage your industrial coatings, track orders, and access technical specs.
                </p>

                <div className="w-full max-w-[320px]">
                    <Button
                        onClick={handleLogin}
                        disabled={isSigningIn}
                        className="w-full text-[10px] tracking-widest uppercase font-black bg-[#165c52] text-white hover:bg-[#0f4d44]"
                        size="lg"
                    >
                        {isSigningIn ? "Authorizing..." : "Authenticate with Google"}
                    </Button>
                </div>
            </div>
        );
    }

    // Process Shopify Data
    const amountSpent = customerData?.amountSpent?.amount || "0.00";
    const orders = customerData?.orders?.edges?.map((e: any) => e.node) || [];

    const unfulfilledCount = orders.filter((o: any) => o.displayFulfillmentStatus === 'UNFULFILLED').length;

    // User Info Fallbacks
    const company = customerData?.defaultAddress?.company || "";
    const name = customerData ? `${customerData.firstName || ''} ${customerData.lastName || ''}`.trim() : user.displayName;
    const address = customerData?.defaultAddress
        ? `${customerData.defaultAddress.address1}, ${customerData.defaultAddress.city}, ${customerData.defaultAddress.province || ''}`
        : "";

    return (
        <div className="flex flex-col flex-1 w-full mx-auto md:px-0 lg:px-0 xl:px-0 max-w-none bg-white lg:flex-row">
            {/* Sidebar - Clean Light Theme */}
            <aside className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-200 flex lg:flex-col bg-slate-50 p-6 gap-4 lg:gap-8 shrink-0 lg:min-h-[calc(100vh-80px)] overflow-x-auto lg:overflow-x-visible">
                <div className="flex lg:flex-col gap-2 lg:gap-1 min-w-max lg:min-w-0">
                    <p className="hidden lg:block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Management</p>
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={cn("flex items-center gap-3 px-3 py-2 font-bold text-sm transition-colors text-left",
                            activeTab === 'overview' ? "bg-slate-200 lg:border-l-[3px] border-b-[3px] lg:border-b-0 border-[#165c52] text-slate-900" : "text-slate-500 hover:text-slate-900")}
                    >
                        <LayoutDashboard className="w-4 h-4" strokeWidth={2.5} /> Overview
                    </button>
                    <button
                        onClick={() => setActiveTab('orders')}
                        className={cn("flex items-center gap-3 px-3 py-2 font-bold text-sm transition-colors text-left",
                            activeTab === 'orders' ? "bg-slate-200 lg:border-l-[3px] border-b-[3px] lg:border-b-0 border-[#165c52] text-slate-900" : "text-slate-500 hover:text-slate-900")}
                    >
                        <Package className="w-4 h-4" strokeWidth={2.5} /> Orders
                    </button>
                    <button
                        onClick={() => setActiveTab('projects')}
                        className={cn("flex items-center gap-3 px-3 py-2 font-bold text-sm transition-colors text-left",
                            activeTab === 'projects' ? "bg-slate-200 lg:border-l-[3px] border-b-[3px] lg:border-b-0 border-[#165c52] text-slate-900" : "text-slate-500 hover:text-slate-900")}
                    >
                        <Bookmark className="w-4 h-4" strokeWidth={2.5} /> Saved Projects
                    </button>
                    <button
                        onClick={() => setActiveTab('docs')}
                        className={cn("flex items-center gap-3 px-3 py-2 font-bold text-sm transition-colors text-left",
                            activeTab === 'docs' ? "bg-slate-200 lg:border-l-[3px] border-b-[3px] lg:border-b-0 border-[#165c52] text-slate-900" : "text-slate-500 hover:text-slate-900")}
                    >
                        <FileText className="w-4 h-4" strokeWidth={2.5} /> Technical Docs
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={cn("flex items-center gap-3 px-3 py-2 font-bold text-sm transition-colors text-left lg:mt-4",
                            activeTab === 'settings' ? "bg-slate-200 lg:border-l-[3px] border-b-[3px] lg:border-b-0 border-[#165c52] text-slate-900" : "text-slate-500 hover:text-slate-900")}
                    >
                        <Settings className="w-4 h-4" strokeWidth={2.5} /> Settings
                    </button>

                    <button onClick={handleLogout} className="flex items-center lg:w-full gap-3 px-3 py-2 lg:py-3 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors font-bold text-sm lg:mt-8 lg:border-t border-slate-200">
                        <ArrowLeftFromLine className="w-4 h-4" strokeWidth={2.5} /> Sign Out
                    </button>
                </div>

                <div className="hidden lg:block mt-auto p-5 bg-[#165c52]/5 border border-[#165c52]/15">
                    <p className="text-[10px] font-black text-[#165c52] uppercase tracking-widest mb-1">Support Tier</p>
                    <p className="text-sm font-bold text-slate-900 mb-4">{profile?.role === 'admin' ? "System Admin" : "Standard Account"}</p>
                    <Button className="w-full py-2 bg-[#165c52] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#0f4d44] transition-all rounded-none shadow-none h-auto">
                        Contact Specialist
                    </Button>
                </div>
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 p-4 sm:p-8 md:p-12 lg:pl-16 max-w-7xl min-h-screen">
                <div className="mb-8 lg:mb-12 flex flex-col-reverse lg:flex-row items-start lg:items-center justify-between border-b border-slate-200 pb-8 gap-6">
                    <div>
                        <h1 className="text-[32px] leading-none font-black text-slate-900 uppercase tracking-tighter mb-2">
                            {activeTab === 'overview' && 'Account Overview'}
                            {activeTab === 'orders' && 'Order History'}
                            {activeTab === 'projects' && 'Saved Projects'}
                            {activeTab === 'docs' && 'Technical Documentation'}
                            {activeTab === 'settings' && 'Account Settings'}
                        </h1>
                        <p className="text-slate-500 font-medium text-sm">
                            {activeTab === 'overview' && 'Control center for industrial coatings and project management.'}
                            {activeTab === 'orders' && 'Track and manage your past and current industrial deliveries.'}
                            {activeTab === 'projects' && 'Your AI-generated solutions and saved product configurations.'}
                            {activeTab === 'docs' && 'Compliance certificates, MSDS, and technical data sheets.'}
                            {activeTab === 'settings' && 'Manage your organization profile, billing, and security preferences.'}
                        </p>
                    </div>

                    <div className="flex w-full lg:w-auto items-center gap-4 bg-slate-50 border border-slate-200 p-2 pr-6 shrink-0">
                        <div className="w-10 h-10 bg-white border border-slate-200 flex items-center justify-center p-0.5">
                            {user.photoURL ? (
                                <img
                                    src={user.photoURL}
                                    alt={user.displayName || "User"}
                                    width={40}
                                    height={40}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <UserIcon className="w-6 h-6 text-slate-400" />
                            )}
                        </div>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center">
                            <span className="text-[11px] font-black uppercase tracking-widest text-slate-900">{user.displayName?.split(" ")[0] || "USER"}</span>
                            <span className="text-[10px] text-slate-500 break-all">{user.email}</span>
                        </div>
                    </div>
                </div>

                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-12 sm:mb-16">
                            <div className="bg-white border border-slate-200 p-6 flex flex-col justify-between hover:border-[#165c52] transition-colors h-[160px]">
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Active Projects</p>
                                    <h3 className="text-4xl font-black text-slate-900 tracking-tighter">{unfulfilledCount}</h3>
                                </div>
                                <Factory className="w-6 h-6 text-[#165c52]" strokeWidth={2} />
                            </div>
                            <div className="bg-white border border-slate-200 p-6 flex flex-col justify-between hover:border-[#165c52] transition-colors h-[160px]">
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Lifetime Spend</p>
                                    <h3 className="text-4xl font-black text-slate-900 tracking-tighter">${parseFloat(amountSpent).toLocaleString('en-US', { minimumFractionDigits: 2 })}</h3>
                                </div>
                                <Banknote className="w-6 h-6 text-[#165c52]" strokeWidth={2} />
                            </div>
                            <div className="bg-white border border-slate-200 p-6 flex flex-col justify-between hover:border-[#165c52] transition-colors h-[160px]">
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Orders</p>
                                    <h3 className="text-4xl font-black text-slate-900 tracking-tighter">{customerData?.numberOfOrders || 0}</h3>
                                </div>
                                <Package className="w-6 h-6 text-[#165c52]" strokeWidth={2} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 sm:gap-12">
                            {/* Recent Orders Overview */}
                            <section>
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900">Recent Orders</h2>
                                    <button onClick={() => setActiveTab('orders')} className="text-[10px] font-black uppercase tracking-widest text-[#165c52] border-b-2 border-[#165c52] pb-0.5">View All</button>
                                </div>

                                {orders.length > 0 ? (
                                    <div className="border border-slate-200 divide-y divide-slate-100">
                                        {orders.slice(0, 3).map((order: any, idx: number) => {
                                            const dateStr = new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                            const isFulfilled = order.displayFulfillmentStatus === 'FULFILLED' || order.displayFulfillmentStatus === 'DELIVERED';
                                            return (
                                                <div key={idx} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer group">
                                                    <div>
                                                        <p className="font-bold text-slate-900 text-sm group-hover:text-[#165c52] transition-colors">{order.name}</p>
                                                        <p className="text-[11px] text-slate-500 mt-0.5">{dateStr}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-bold text-slate-900 text-sm">${parseFloat(order.totalPriceSet?.shopMoney?.amount || "0").toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                                                        <p className={cn("text-[9px] font-black uppercase tracking-widest mt-1", isFulfilled ? "text-[#165c52]" : "text-amber-600")}>
                                                            {isFulfilled ? "Delivered" : "In Transit"}
                                                        </p>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <div className="bg-slate-50 border border-slate-200 border-dashed p-10 flex flex-col items-center justify-center text-center">
                                        <Inbox className="w-10 h-10 text-slate-300 mb-4" />
                                        <p className="text-sm font-bold text-slate-900">No active orders</p>
                                        <p className="text-xs text-slate-500 mt-1 max-w-xs">You haven't placed any industrial coating orders yet.</p>
                                        <Button className="mt-6 bg-slate-900 text-white rounded-none shadow-none uppercase text-[10px] font-black tracking-widest px-6 hover:bg-slate-800">
                                            Browse Catalog
                                        </Button>
                                    </div>
                                )}
                            </section>

                            {/* Account Details */}
                            <section>
                                <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900 mb-6">Organization Profile</h2>
                                <div className="bg-slate-50 border border-slate-200 p-8 h-fit">
                                    <div className="space-y-6">
                                        {company ? (
                                            <div className="flex flex-col gap-1">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Organization</p>
                                                <p className="text-[13px] font-bold text-slate-900 border-b border-slate-200 pb-2">{company}</p>
                                            </div>
                                        ) : null}

                                        <div className="flex flex-col gap-1">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Primary Contact</p>
                                            <p className="text-[13px] font-bold text-slate-900 border-b border-slate-200 pb-2">{name}</p>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Email Address</p>
                                            <p className="text-[13px] font-bold text-slate-900 border-b border-slate-200 pb-2">{user.email}</p>
                                        </div>

                                        {address ? (
                                            <div className="flex flex-col gap-1">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Billing Address</p>
                                                <p className="text-[13px] font-bold text-slate-900 border-b border-slate-200 pb-2">{address}</p>
                                            </div>
                                        ) : null}

                                        <div className="pt-2">
                                            <button
                                                onClick={() => setActiveTab('settings')}
                                                className="text-[#165c52] text-[9px] font-black uppercase tracking-widest hover:underline"
                                            >
                                                Update Profile Details
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                )}

                {/* ORDERS TAB */}
                {activeTab === 'orders' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {orders.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse min-w-[800px] border border-slate-200 bg-white">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                                            <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">Order Reference</th>
                                            <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">Date</th>
                                            <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px] w-1/3">Products</th>
                                            <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px]">Status</th>
                                            <th className="px-6 py-4 font-black uppercase tracking-widest text-[10px] text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {orders.map((order: any, idx: number) => {
                                            const dateStr = new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                            const isFulfilled = order.displayFulfillmentStatus === 'FULFILLED' || order.displayFulfillmentStatus === 'DELIVERED';

                                            return (
                                                <tr key={idx} className="group hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-6 py-5 font-bold text-slate-900 text-[13px] group-hover:text-[#165c52] cursor-pointer">{order.name}</td>
                                                    <td className="px-6 py-5 text-slate-500 text-[13px] font-medium">{dateStr}</td>
                                                    <td className="px-6 py-5 text-slate-500 text-[12px] truncate max-w-[200px]">
                                                        {order.lineItems?.edges?.map((e: any) => e.node.name).join(", ")}
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <span className={cn(
                                                            "inline-flex items-center text-[9px] font-black uppercase px-2 py-1 tracking-widest",
                                                            isFulfilled
                                                                ? "bg-[#165c52]/10 text-[#165c52]"
                                                                : "bg-slate-100 text-slate-600"
                                                        )}>
                                                            {isFulfilled ? "Delivered" : "In Transit"}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-5 font-bold text-slate-900 text-right text-[13px]">${parseFloat(order.totalPriceSet?.shopMoney?.amount || "0").toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="bg-white border border-slate-200 border-dashed py-24 flex flex-col items-center justify-center text-center">
                                <Package className="w-12 h-12 text-slate-300 mb-4" strokeWidth={1.5} />
                                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-2">No Order History</h3>
                                <p className="text-sm text-slate-500 max-w-sm mb-8 leading-relaxed">Your account doesn't have any past orders linked. Once you finalize a purchase, it will strictly be documented here.</p>
                                <Button className="bg-[#165c52] text-white rounded-none shadow-none uppercase text-[10px] font-black tracking-widest px-8 hover:bg-[#0f4d44]">
                                    Browse Inventory
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {/* SAVED PROJECTS / AI SOLUTIONS */}
                {activeTab === 'projects' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {/* Empty state assumes no saved projects fetched yet */}
                        <div className="bg-white border border-slate-200 border-dashed py-24 flex flex-col items-center justify-center text-center">
                            <Bookmark className="w-12 h-12 text-slate-300 mb-4" strokeWidth={1.5} />
                            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-2">No Saved Configurations</h3>
                            <p className="text-sm text-slate-500 max-w-sm mb-8 leading-relaxed">Save custom paint configurations or AI-generated solution plans to access them instantly.</p>
                            <Button className="bg-[#165c52] text-white rounded-none shadow-none uppercase text-[10px] font-black tracking-widest px-8 hover:bg-[#0f4d44]">
                                Explore AI Solutions
                            </Button>
                        </div>
                    </div>
                )}

                {/* TECHNICAL DOCS */}
                {activeTab === 'docs' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="bg-white border border-slate-200 border-dashed py-24 flex flex-col items-center justify-center text-center">
                            <FileImage className="w-12 h-12 text-slate-300 mb-4" strokeWidth={1.5} />
                            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-2">Documentation Vault</h3>
                            <p className="text-sm text-slate-500 max-w-sm mb-8 leading-relaxed">Access MSDS, Technical Data Sheets, and Compliance Certificates generated from your recent orders.</p>
                            <Button className="bg-slate-900 text-white rounded-none shadow-none uppercase text-[10px] font-black tracking-widest px-8 hover:bg-slate-800" disabled>
                                No Documents Available
                            </Button>
                        </div>
                    </div>
                )}

                {/* SETTINGS */}
                {activeTab === 'settings' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
                        <div className="space-y-8">
                            <div className="bg-white border border-slate-200 p-8">
                                <h3 className="text-lg font-black uppercase tracking-tighter text-slate-900 mb-6">Security & Authentication</h3>
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Connected Account</p>
                                        <div className="flex items-center justify-between py-3 border-b border-slate-100">
                                            <div className="flex items-center gap-3">
                                                {user.photoURL ? (
                                                    <img src={user.photoURL} alt="Google Auth" className="w-6 h-6 object-cover" />
                                                ) : <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google Auth" className="w-6 h-6" />}
                                                <span className="font-bold text-sm text-slate-900">{user.email}</span>
                                            </div>
                                            <span className="text-[10px] font-black uppercase text-[#165c52] bg-[#165c52]/10 px-2 py-1">Verified</span>
                                        </div>
                                    </div>

                                    <div className="pt-4">
                                        <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-none shadow-none uppercase text-[10px] font-black tracking-widest" onClick={handleLogout}>
                                            Revoke Access
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 p-8 text-center text-slate-500 text-sm italic">
                                Additional billing and organizational preferences are managed directly through you dedicated account specialist at this time.
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Mobile nav spacing */}
            <div className="h-16 lg:hidden w-full shrink-0"></div>
        </div>
    );
}
