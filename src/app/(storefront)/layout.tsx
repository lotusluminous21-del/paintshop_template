import React from "react";
import { Header } from "@/components/industrial_ui/Header";
import { Footer, FooterColumn } from "@/components/industrial_ui/Footer";
import { Layers } from "lucide-react";

const footerColumns: FooterColumn[] = [
    {
        title: "Products",
        links: [
            { label: "Industrial Paints", href: "#" },
            { label: "Professional Aerosols", href: "#" },
            { label: "Primers & Sealers", href: "#" },
            { label: "Cleaning Agents", href: "#" }
        ]
    },
    {
        title: "Company",
        links: [
            { label: "Our Story", href: "/about" },
            { label: "Certifications", href: "#" },
            { label: "Technical Data", href: "#" },
            { label: "Contact", href: "/contact" }
        ]
    },
    {
        title: "Connect",
        links: [
            { label: "Instagram", href: "#" },
            { label: "LinkedIn", href: "#" },
            { label: "Architect Portal", href: "#" }
        ]
    }
];

export default function StorefrontLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="relative flex min-h-screen w-full flex-col overflow-x-clip bg-background text-foreground font-sans bg-[radial-gradient(circle,#00000010_1px,transparent_1px)] bg-[size:40px_40px] bg-fixed">
            <div className="flex h-full grow flex-col">
                <Header />
                <main className="flex-1 w-full flex flex-col mb-16">
                    {children}
                </main>
                <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 pb-12 mt-24 border-t border-border pt-12">
                    <Footer
                        logo={<div className="bg-primary p-1 rounded"><Layers className="text-primary-foreground w-4 h-4" /></div>}
                        companyName="Pavlicevits"
                        tagline="Setting the standard in high-performance coatings and architectural finishes. Precision in every layer."
                        columns={footerColumns}
                        copyrightYear={new Date().getFullYear()}
                        className="bg-transparent border-t-0 !px-0 mt-0 pt-0"
                        bottomLinks={[
                            { label: "Privacy Policy", href: "#" },
                            { label: "Terms of Service", href: "#" }
                        ]}
                    />
                </div>
            </div>
        </div>
    );
}
